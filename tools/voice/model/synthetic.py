"""Research fixtures only; never a substitute for consented speakers."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import wave
import numpy as np
from detector import RATE, WINDOW, digest

PHRASES = [(True,"hey bush mesh"),(False,"hey bush"),(False,"bush mesh"),
           (False,"hey push mesh"),(False,"hey bush mess"),(False,"hey bushmeat"),
           (False,"hey push me"),(False,"hey good morning"),
           (False,"the bush track is muddy"),(False,"the mesh network is connected"),
           (False,"turn left at the next intersection"),(False,"radio check please")]
VOICES = {"train":["en-us","en-gb"],"tune":["en-sc"],"test":["en-wi"]}

def generate(root):
    root.mkdir(parents=True,exist_ok=False)
    rows=[]
    rng=np.random.default_rng(808)
    with tempfile.TemporaryDirectory() as temp:
        raw=Path(temp)/"raw.wav"
        for split, voices in VOICES.items():
            for voice in voices:
                for variant in ("m1","f2"):
                    for speed in (155,185,215):
                        for i,(positive,phrase) in enumerate(PHRASES):
                            stem=f"{voice}-{variant}-{speed}-{i}"
                            subprocess.run(["espeak-ng","-v",voice+"+"+variant,
                                            "-s",str(speed),"-w",str(raw),phrase],check=True)
                            result=subprocess.run(["ffmpeg","-v","error","-i",str(raw),
                                "-ar","16000","-ac","1","-f","s16le","-"],check=True,capture_output=True)
                            pcm=np.frombuffer(result.stdout,dtype="<i2")
                            active=np.flatnonzero(np.abs(pcm.astype(np.int32))>150)
                            if not len(active):
                                raise ValueError("empty synthesized utterance")
                            start=max(0,int(active[0])-160)
                            end=min(len(pcm),int(active[-1])+160)
                            if positive and end-start>WINDOW:
                                raise ValueError("positive phrase exceeds window: "+stem)
                            pcm=pcm[start:end]
                            for condition in ("clean","noise"):
                                x=pcm.astype(np.float32)
                                if condition=="noise":
                                    noise=np.convolve(rng.normal(size=len(x)),np.ones(10)/10,mode="same")
                                    x+=noise * max(50,np.sqrt(np.mean(x*x))) / max(noise.std(),1e-6) * .316
                                path=root/(stem+"-"+condition+".wav")
                                with wave.open(str(path),"wb") as f:
                                    f.setparams((1,2,RATE,0,"NONE","not compressed"))
                                    f.writeframes(np.clip(x,-32768,32767).astype("<i2").tobytes())
                                rows.append({"file":path.name,"positive":positive,"split":split,
                                    "speaker":"espeak-ng:"+voice,"source_id":stem,
                                    "rights":"synthetic-research-only","sha256":digest(path),
                                    "start":0,"end":len(pcm),"condition":condition})
    (root/"manifest.json").write_text(json.dumps(rows,indent=2))

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("root",type=Path)
    generate(p.parse_args().root)
