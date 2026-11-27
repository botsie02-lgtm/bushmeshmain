#!/usr/bin/env python3
"""Offline PCM qualification; never starts a microphone or submits a message."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import resource
import struct
import subprocess
import time
import wave
import zipfile

MODEL_NAME = "vosk-model-small-en-us-0.15"
MODEL_SHA = "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"
MODEL_URLS = [
    "https://alphacephei.com/vosk/models/" + MODEL_NAME + ".zip",
    "https://huggingface.co/rhasspy/vosk-models/resolve/main/en/" + MODEL_NAME + ".zip",
]
RATE = 16000
MIN_CONFIDENCE = 0.85
WAKE_WORDS = (("hey", "bush", "mesh"), ("hey", "bushmesh"))
GRAMMAR = ["hey bush mesh", "[unk]"]


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def provision(root):
    root.mkdir(parents=True, exist_ok=True)
    archive = root / (MODEL_NAME + ".zip")
    if not archive.exists() or digest(archive) != MODEL_SHA:
        archive.unlink(missing_ok=True)
        for url in MODEL_URLS:
            temporary = archive.with_suffix(".partial")
            try:
                subprocess.run(["curl", "--fail", "--location", "--silent",
                                "--show-error", "--max-time", "180", "--retry", "2",
                                "--output", str(temporary), url], check=True)
                if digest(temporary) != MODEL_SHA:
                    raise ValueError("Model SHA-256 mismatch")
                temporary.replace(archive)
                break
            except (subprocess.CalledProcessError, ValueError):
                temporary.unlink(missing_ok=True)
        else:
            raise RuntimeError("Pinned model unavailable; no unverified fallback")
    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        if sum(m.file_size for m in members) > 200_000_000:
            raise ValueError("Unexpected uncompressed model size")
        for m in members:
            p = Path(m.filename)
            if p.is_absolute() or ".." in p.parts or not p.parts or p.parts[0] != MODEL_NAME:
                raise ValueError("Unexpected archive path")
            if (m.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Unexpected archive symlink")
        zipped.extractall(root)
    model = root / MODEL_NAME
    report = {"model": MODEL_NAME, "archive_sha256": digest(archive),
              "archive_bytes": archive.stat().st_size,
              "unpacked_bytes": sum(p.stat().st_size for p in model.rglob("*") if p.is_file())}
    (root / "model-provenance.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)
    return model


def read_pcm(path):
    with wave.open(str(path), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, RATE, "NONE"):
            raise ValueError("Expected mono 16-bit 16 kHz PCM: " + path.name)
        if not 0 < wav.getnframes() <= RATE * 60:
            raise ValueError("Fixture must be 0–60 seconds: " + path.name)
        return wav.readframes(wav.getnframes())


def write_pcm(path, pcm):
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(pcm)


def generate(root):
    """Real acoustic waveforms from a local synthesizer, NOT human speech."""
    root.mkdir(parents=True, exist_ok=True)
    phrases = [
        (True, "hey bush mesh"), (False, "hey bush"), (False, "bush mesh"),
        (False, "hey bush mess"), (False, "hey push mesh"),
        (False, "hey bush mesh send a message"), (False, "wait at the next intersection"),
        (False, "hey google"), (False, "the radio is connected"),
    ]
    manifest = []
    for voice in ("en-gb", "en-us"):
        for index, (positive, phrase) in enumerate(phrases):
            stem = f"{voice}-{index:02d}"
            raw = root / (stem + "-raw.wav")
            base = root / (stem + "-base.wav")
            subprocess.run(["espeak-ng", "-v", voice, "-s", "145", "-w", str(raw), phrase], check=True)
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                            "-i", str(raw), "-ac", "1", "-ar", str(RATE),
                            "-c:a", "pcm_s16le", str(base)], check=True)
            pcm = read_pcm(base)
            raw.unlink()
            base.unlink()
            # Explicit silence for streaming endpoint detection.
            samples = [0] * 4800 + list(struct.unpack("<" + "h" * (len(pcm)//2), pcm)) + [0] * RATE * 2
            for snr in (None, 10):
                data = samples.copy()
                if snr is not None:
                    rms = math.sqrt(sum(v*v for v in samples)/len(samples))
                    rng = random.Random(12345 + index)
                    sigma = rms * 10 ** (-snr / 20)
                    data = [max(-32768, min(32767, round(v + rng.gauss(0, sigma)))) for v in data]
                filename = stem + ("-clean.wav" if snr is None else "-noise10.wav")
                write_pcm(root / filename, struct.pack("<" + "h" * len(data), *data))
                manifest.append({"file": filename, "positive": positive, "source": "synthetic-espeak-ng",
                                 "voice": voice, "noise_db": snr, "sha256": digest(root / filename)})
    silence = root / "silence.wav"
    write_pcm(silence, bytes(RATE * 2 * 4))
    manifest.append({"file": silence.name, "positive": False, "source": "synthetic-silence",
                     "voice": None, "noise_db": None, "sha256": digest(silence)})
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Generated {len(manifest)} acoustic fixtures; no human recordings", flush=True)


def qualifies(result):
    text = tuple(result.get("text", "").split())
    words = result.get("result", [])
    return (text in WAKE_WORDS and tuple(w.get("word") for w in words) == text
            and all(isinstance(w.get("conf"), (float, int)) and not isinstance(w["conf"], bool)
                    and math.isfinite(w["conf"]) and MIN_CONFIDENCE <= w["conf"] <= 1
                    for w in words))


def evaluate(model_path, fixture_dir, output):
    import vosk
    vosk.SetLogLevel(-1)
    rows = json.loads((fixture_dir / "manifest.json").read_text())
    if not rows or not any(r["positive"] is True for r in rows) or not any(r["positive"] is False for r in rows):
        raise ValueError("Require positive and negative audio")
    start = time.perf_counter()
    model = vosk.Model(str(model_path))
    model_load_ms = round((time.perf_counter() - start)*1000)
    trials = []
    for mode in ("unconstrained", "grammar"):
        for item in rows:
            relative = Path(item["file"])
            if relative.name != item["file"] or relative.suffix != ".wav":
                raise ValueError("Fixture paths must be simple WAV filenames")
            path = fixture_dir / relative
            if not isinstance(item["positive"], bool) or digest(path) != item["sha256"]:
                raise ValueError("Invalid fixture label or digest")
            pcm = read_pcm(path)
            wall = time.perf_counter()
            cpu = time.process_time()
            rec = (vosk.KaldiRecognizer(model, RATE) if mode == "unconstrained"
                   else vosk.KaldiRecognizer(model, RATE, json.dumps(GRAMMAR)))
            rec.SetWords(True)
            detected = False
            for offset in range(0, len(pcm), 3200):
                if rec.AcceptWaveform(pcm[offset:offset + 3200]):
                    detected |= qualifies(json.loads(rec.Result()))
            # Live endpoint only. Do not turn forced EOF into a wake event.
            rec.FinalResult()
            del rec
            trials.append({"file": relative.name, "expected": item["positive"], "detected": detected,
                           "mode": mode, "source": item.get("source", "unspecified"),
                           "audio_seconds": len(pcm)/(RATE*2),
                           "cpu_ms": round((time.process_time()-cpu)*1000, 2),
                           "wall_ms": round((time.perf_counter()-wall)*1000, 2)})
    summaries = {}
    for mode in ("unconstrained", "grammar"):
        selected = [r for r in trials if r["mode"] == mode]
        summaries[mode] = {
            "true_positive": sum(r["expected"] and r["detected"] for r in selected),
            "missed": sum(r["expected"] and not r["detected"] for r in selected),
            "false_activation": sum(not r["expected"] and r["detected"] for r in selected),
            "true_negative": sum(not r["expected"] and not r["detected"] for r in selected),
            "audio_seconds": round(sum(r["audio_seconds"] for r in selected), 3),
            "cpu_ms": round(sum(r["cpu_ms"] for r in selected), 2),
        }
    report = {"engine": "vosk", "runtime": "0.3.45", "model": MODEL_NAME,
              "model_load_ms": model_load_ms, "host_peak_rss_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
              "min_word_confidence": MIN_CONFIDENCE, "summaries": summaries, "trials": trials,
              "operational_qualification": False}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "trials"}, indent=2), flush=True)
    # A true positive is essential for even a proof of acoustic recognition.
    # False activations are recorded, not optimized away or concealed.
    if not any(s["true_positive"] for s in summaries.values()):
        raise RuntimeError("No genuine positive endpoint recognition; qualification failed")


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("provision")
    p.add_argument("root", type=Path)
    g = sub.add_parser("generate")
    g.add_argument("fixtures", type=Path)
    e = sub.add_parser("evaluate")
    e.add_argument("model", type=Path)
    e.add_argument("fixtures", type=Path)
    e.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.command == "provision":
        provision(args.root)
    elif args.command == "generate":
        generate(args.fixtures)
    else:
        evaluate(args.model, args.fixtures, args.output)


if __name__ == "__main__":
    main()
