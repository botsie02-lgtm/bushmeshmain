"""Local-only training and evaluation. Candidate metrics never imply approval."""
import argparse
import hashlib
import json
import resource
import time
import wave
from pathlib import Path
import numpy as np
import torch
from torch import nn
from detector import RATE, WINDOW, HOP, SHAPE, VERSION, Detector, features, digest, load_candidate

SPLITS = ("train", "tune", "test")

def read_wav(path):
    with wave.open(str(path), "rb") as f:
        if (f.getnchannels(), f.getsampwidth(), f.getframerate(), f.getcomptype()) != (1, 2, RATE, "NONE"):
            raise ValueError("expected mono PCM16 16 kHz")
        if not 0 < f.getnframes() <= RATE * 600:
            raise ValueError("invalid duration")
        return np.frombuffer(f.readframes(f.getnframes()), dtype="<i2").copy()

def corpus(manifest):
    rows = json.loads(manifest.read_text())
    seen = {}
    for row in rows:
        if row["split"] not in SPLITS or type(row["positive"]) is not bool:
            raise ValueError("invalid split/label")
        if row["rights"] not in ("consented-commercial-training", "reviewed-commercial", "synthetic-research-only"):
            raise ValueError("unreviewed data rights")
        path = (manifest.parent / row["file"]).resolve()
        if not path.is_relative_to(manifest.parent.resolve()):
            raise ValueError("path outside corpus")
        if digest(path) != row["sha256"]:
            raise ValueError("recording hash mismatch")
        for field in ("speaker", "source_id", "sha256"):
            value = row[field]
            if not isinstance(value, str) or not value:
                raise ValueError("missing provenance")
            key = (field, value)
            if seen.setdefault(key, row["split"]) != row["split"]:
                raise ValueError("cross-split leakage: " + field)
        row["pcm"] = read_wav(path)
        if row["positive"]:
            a, z = row["start"], row["end"]
            if not (type(a) is int and type(z) is int and 0 <= a < z <= len(row["pcm"]) and z-a <= WINDOW):
                raise ValueError("positive needs sample interval fitting input window")
    for split in SPLITS:
        if {r["positive"] for r in rows if r["split"] == split} != {True, False}:
            raise ValueError("each split needs both labels")
    return rows

def window_at(pcm, end):
    start = end - WINDOW
    out = np.zeros(WINDOW, dtype=np.int16)
    a, b = max(0, start), min(end, len(pcm))
    if b > a:
        out[a-start:b-start] = pcm[a:b]
    return out

def training_data(rows, seed):
    rng = np.random.default_rng(seed)
    xs, ys = [], []
    for r in rows:
        if r["split"] != "train":
            continue
        pcm = r["pcm"]
        if r["positive"]:
            ends = [r["end"] + int(rng.integers(0, min(4800, WINDOW-(r["end"]-r["start"]))+1)) for _ in range(8)]
        else:
            ends = list(range(HOP, len(pcm)+HOP, HOP*3)) + [len(pcm)]
            # Balance without discarding long negatives during evaluation.
            if len(ends) > 24:
                ends = rng.choice(ends, 24, replace=False)
        for end in ends:
            x = window_at(pcm, int(end)).astype(np.float32)
            gain = rng.uniform(.4, 1.4)
            x *= gain
            if rng.random() < .8:
                rms = max(50, float(np.sqrt(np.mean(x*x))))
                noise = rng.normal(0, 1, WINDOW)
                if rng.random() < .5:
                    noise = np.convolve(noise, np.ones(12)/12, mode="same")
                noise *= rms * 10**(-rng.uniform(0, 30)/20) / max(noise.std(), 1e-6)
                x += noise
            xs.append(features(np.clip(x, -32768, 32767).astype(np.int16))[0])
            ys.append(float(r["positive"]))
    return torch.from_numpy(np.stack(xs)), torch.tensor(ys).reshape(-1,1)

def model(kind):
    def ds(a, b, stride):
        return [nn.Conv2d(a,a,3,stride,padding=1,groups=a,bias=False),
                nn.BatchNorm2d(a),nn.ReLU(),nn.Conv2d(a,b,1,bias=False),
                nn.BatchNorm2d(b),nn.ReLU()]
    if kind == "ds":
        layers = [nn.Conv2d(1,16,3,2,1),nn.BatchNorm2d(16),nn.ReLU(),
                  *ds(16,24,2),*ds(24,32,2),*ds(32,48,1)]
    else:
        layers = [nn.Conv2d(1,24,(5,5),(2,4),(2,2)),nn.ReLU(),
                  nn.Conv2d(24,24,(5,1),(2,1),(2,0)),nn.ReLU(),
                  nn.Conv2d(24,32,(5,1),(2,1),(4,0),dilation=(2,1)),nn.ReLU()]
    # Preserve coarse time/frequency location via fixed pooling and flatten.
    return nn.Sequential(*layers,nn.AvgPool2d((2,2)),nn.Flatten(),
                         nn.LazyLinear(1))

def stream(rows, score, split):
    result = []
    for r in rows:
        if r["split"] != split:
            continue
        # Fixed pre-roll simulates an already listening detector; no EOF-trigger.
        pcm = np.concatenate((np.zeros(WINDOW,dtype=np.int16),r["pcm"],
                              np.zeros(8000,dtype=np.int16)))
        scores = []
        d = Detector(score, .5)
        start = time.perf_counter()
        cpu = time.process_time()
        for i in range(0,len(pcm),HOP):
            scores.extend(d.feed(pcm[i:i+HOP]))
        result.append({"file":r["file"],"positive":r["positive"],
                       "source_id":r["source_id"],"speaker":r["speaker"],
                       "rights":r["rights"],"seconds":len(pcm)/RATE,
                       "start":WINDOW+r.get("start",0),
                       "end":WINDOW+r.get("end",0),"scores":scores,
                       "cpu_seconds":time.process_time()-cpu,
                       "wall_seconds":time.perf_counter()-start})
    return result

def metrics(traces, threshold):
    tp=fp=miss=tn=events=0
    neg_seconds=0
    latency=[]
    details=[]
    for t in traces:
        streak=cooldown=0
        armed=True
        wakes=[]
        for s in t["scores"]:
            cooldown=max(0,cooldown-1)
            if s["score"] < threshold:
                streak=0
                armed=True
            else:
                streak=min(2,streak+1)
            if armed and cooldown==0 and streak>=2:
                wakes.append(s["sample"])
                armed=False
                cooldown=20
                streak=0
        if t["positive"]:
            valid=[w for w in wakes if t["start"] <= w <= t["end"]+8000]
            tp+=bool(valid)
            miss+=not valid
            if valid:
                latency.append((valid[0]-t["end"])*1000/RATE)
        else:
            fp+=bool(wakes)
            tn+=not wakes
            events+=len(wakes)
            neg_seconds+=t["seconds"]
        details.append({"file":t["file"],"wake_samples":wakes,"positive":t["positive"]})
    return {"threshold":threshold,"true_positive":tp,"missed":miss,
            "false_positive_clips":fp,"true_negative":tn,"false_events":events,
            "negative_seconds":neg_seconds,
            "false_events_per_hour":events*3600/neg_seconds,
            "positive_recall":tp/(tp+miss),"latency_ms_from_phrase_end":latency,
            "cpu_seconds":sum(t["cpu_seconds"] for t in traces),
            "wall_seconds":sum(t["wall_seconds"] for t in traces),
            "details":details}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("manifest",type=Path)
    p.add_argument("output",type=Path)
    p.add_argument("--architecture",choices=["ds","temporal"],default="ds")
    p.add_argument("--seed",type=int,default=31415)
    p.add_argument("--epochs",type=int,default=15)
    a=p.parse_args()
    if a.epochs < 1:
        raise ValueError("epochs must be positive")
    torch.manual_seed(a.seed)
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    rows=corpus(a.manifest)
    x,y=training_data(rows,a.seed)
    net=model(a.architecture)
    net.eval()
    with torch.no_grad():
        net(torch.zeros(SHAPE))
    net.train()
    opt=torch.optim.AdamW(net.parameters(),lr=.002)
    lossfn=nn.BCEWithLogitsLoss(pos_weight=(len(y)-y.sum())/y.sum())
    losses=[]
    for _ in range(a.epochs):
        total=0
        for idx in torch.randperm(len(y)).split(32):
            opt.zero_grad()
            loss=lossfn(net(x[idx]),y[idx])
            loss.backward()
            opt.step()
            total+=loss.item()*len(idx)
        losses.append(total/len(y))
    net.eval()
    exported=nn.Sequential(net,nn.Sigmoid())
    a.output.mkdir(parents=True,exist_ok=False)
    path=a.output/"wake.onnx"
    torch.onnx.export(exported,torch.zeros(SHAPE),str(path),input_names=["logmel"],
                      output_names=["wake_score"],opset_version=17,dynamo=False)
    import onnx
    onnx.checker.check_model(str(path))
    import onnxruntime as ort
    options=ort.SessionOptions()
    options.intra_op_num_threads=options.inter_op_num_threads=1
    session=ort.InferenceSession(str(path),sess_options=options,providers=["CPUExecutionProvider"])
    score=lambda f: float(session.run(["wake_score"],{"logmel":f})[0][0,0])
    with torch.no_grad():
        for f in x[:8]:
            arr=f.unsqueeze(0)
            np.testing.assert_allclose(score(arr.numpy()),exported(arr).item(),rtol=1e-4,atol=1e-5)
    tune=stream(rows,score,"tune")
    sweep=[metrics(tune,float(t)) for t in (.3,.4,.5,.6,.7,.8,.9,.95,.98,.99)]
    chosen=min(sweep,key=lambda m:(m["false_events"],m["missed"],-m["threshold"]))
    meta={"version":VERSION,"sha256":digest(path),"threshold":chosen["threshold"],
          "architecture":a.architecture,"operational_qualification":False,
          "redistribution_approved":False,"seed":a.seed,"manifest_sha256":digest(a.manifest),
          "model_bytes":path.stat().st_size}
    (a.output/"model.json").write_text(json.dumps(meta,indent=2))
    load_candidate(a.output,meta["sha256"])
    test=stream(rows,score,"test")
    report={"model":meta,"parameters":sum(p.numel() for p in net.parameters()),
            "training_windows":len(y),"epochs":a.epochs,"losses":losses,
            "tune_sweep":sweep,"held_out":metrics(test,chosen["threshold"]),
            "peak_host_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            "data_counts":{s:sum(r["split"]==s for r in rows) for s in SPLITS},
            "data_rights":sorted({r["rights"] for r in rows}),
            "torch":torch.__version__,"numpy":np.__version__,"onnxruntime":ort.__version__}
    (a.output/"report.json").write_text(json.dumps(report,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k!="tune_sweep"},indent=2))

if __name__=="__main__":
    main()
