"""Reproducible DEVELOPMENT-only audio, never human or acceptance audio.

Uses locally installed eSpeak NG + FFmpeg for actual synthesized speech.
Generated outputs are not uploaded, are not cleared for redistribution, and
are NOT proof of Australian pronunciation or in-car microphone accuracy.
"""
from __future__ import annotations

from array import array
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess
import tempfile
import wave

from .manifest import SCHEMA, SAMPLE_RATE, sha256, inspect_wav


def clamp(sample: float) -> int:
    return max(-32768, min(32767, int(round(sample))))


def write_wav(path: Path, samples: array) -> None:
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(SAMPLE_RATE)
        audio.writeframes(samples.tobytes())


def speech(phrase: str, voice: str) -> array:
    with tempfile.TemporaryDirectory(prefix="bushmesh-tts-") as temp:
        raw = Path(temp) / "espeak.wav"
        normalized = Path(temp) / "pcm.wav"
        subprocess.run(
            ["espeak-ng", "-v", voice, "-s", "145", "-w", str(raw), phrase],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
             "-y", "-i", str(raw), "-ac", "1", "-ar", str(SAMPLE_RATE),
             "-c:a", "pcm_s16le", str(normalized)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        with wave.open(str(normalized), "rb") as audio:
            pcm = array("h")
            pcm.frombytes(audio.readframes(audio.getnframes()))
            return pcm


def signal(category: str, seconds: int, seed: int) -> array:
    """Entirely original test tones and procedural noise; no external song."""
    randomizer = random.Random(seed)
    out = array("h")
    phases = [0.0, 0.0, 0.0]
    for index in range(seconds * SAMPLE_RATE):
        t = index / SAMPLE_RATE
        if category == "music":
            notes = (196.0, 246.94, 293.66, 392.0)
            chord = (index // (SAMPLE_RATE * 3)) % 4
            hz = notes[chord]
            value = 7000 * (
                0.45 * math.sin(2 * math.pi * hz * t) +
                0.25 * math.sin(2 * math.pi * hz * 1.5 * t) +
                0.10 * math.sin(2 * math.pi * hz * 2.0 * t)
            )
            value *= min(1, (t % 3) / 0.04 + 0.01)
        elif category == "road-engine":
            value = (
                4000 * math.sin(2 * math.pi * (45 + 8 * math.sin(t / 3)) * t)
                + 1900 * math.sin(2 * math.pi * 120 * t)
                + randomizer.gauss(0, 3200)
            )
        elif category == "continuous-background":
            value = (randomizer.gauss(0, 3600) +
                     1900 * math.sin(2 * math.pi * 75 * t) +
                     500 * math.sin(2 * math.pi * 400 * t))
        else:
            value = 0
        out.append(clamp(value))
    return out


def combine(a: array, b: array, offset_ms: int) -> array:
    offset = offset_ms * SAMPLE_RATE // 1000
    length = max(len(a), len(b) + offset)
    out = array("h", [0]) * length
    for i, value in enumerate(a):
        out[i] = clamp(value)
    for i, value in enumerate(b):
        out[i + offset] = clamp(out[i + offset] + value)
    return out


def fixture(
    out: Path, manifest: list[dict], name: str, category: str,
    samples: array, *, speaker_id: str | None = None,
    voice: str | None = None, wake_start_ms: int | None = None,
    wake_end_ms: int | None = None, seed: int,
) -> None:
    filename = name + ".wav"
    path = out / filename
    write_wav(path, samples)
    frames, size = inspect_wav(path)
    source_kind = "synthetic-tts" if voice else "synthetic-signal"
    manifest.append({
        "id": name, "file": filename, "label": "positive" if category == "wake" else "negative",
        "category": category,
        "speaker_id": speaker_id, "session_id": "generated-" + name,
        "recording_source_id": "generated-" + name,
        "source_family_id": "dev-espeak-ng" if voice else "dev-algorithmic-signal",
        "sha256": sha256(path), "frames": frames, "bytes": size,
        "wake_start_ms": wake_start_ms, "wake_end_ms": wake_end_ms,
        "provenance": {
            "kind": source_kind,
            "license": "generator-and-engine-licence-review-required; local-evaluation-only",
            "source": ("eSpeak-NG voice=" + voice if voice else "original bounded deterministic signal")
                      + f"; generator_seed={seed}; repo=tools/voice/qualification/generate.py",
            "consent_id": None, "permission_to_evaluate": True,
            "permission_to_redistribute": False,
        },
    })


def generate(root: Path, seed: int = 0xB05A) -> dict:
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    if (root / "manifest.json").exists():
        raise FileExistsError("Refuse to replace an existing dataset; choose a clean folder")
    manifest: list[dict] = []
    phrases = [
        ("wake", "hey bush mesh"),
        ("hard-negative", "hey bush"),
        ("hard-negative", "bush mesh"),
        ("similar-sounding", "hey push mesh"),
        ("similar-sounding", "hey bush mess"),
        ("similar-sounding", "hey brush mesh"),
        ("hard-negative", "hey bus mesh"),
        ("hard-negative", "hey google"),
    ]
    for voice in ("en-gb", "en-us"):
        for index, (category, phrase) in enumerate(phrases):
            utterance = speech(phrase, voice)
            prefix = array("h", [0]) * (SAMPLE_RATE // 2)
            suffix = array("h", [0]) * SAMPLE_RATE
            samples = prefix + utterance + suffix
            fixture(root, manifest, f"tts-{voice}-{index:02d}", category, samples,
                    speaker_id=f"synthetic-{voice}", voice=voice,
                    wake_start_ms=500 if category == "wake" else None,
                    wake_end_ms=(500 + len(utterance) * 1000 / SAMPLE_RATE)
                    if category == "wake" else None, seed=seed)
    conversations = [
        ("passenger-conversation", "do you want to stop near the bush track",
         "yeah after the creek crossing"),
        ("spoken-radio", "road conditions ahead are dry and windy",
         "expect a delay near the bushland lookout"),
        ("bushmesh-playback", "BushMesh radio connection is ready",
         "Your message has not been sent yet"),
    ]
    for i, (category, text_a, text_b) in enumerate(conversations):
        first = speech(text_a, "en-gb")
        second = speech(text_b, "en-us")
        samples = array("h", [0]) * (SAMPLE_RATE // 2) + combine(first, second, 1400)
        samples += array("h", [0]) * SAMPLE_RATE
        fixture(root, manifest, f"conversation-{i:02d}", category, samples,
                speaker_id="synthetic-two-voice-ensemble", voice="en-gb+en-us", seed=seed)
    for i, (category, duration) in enumerate((
        ("music", 16), ("road-engine", 18),
        ("continuous-background", 45), ("silence", 25),
    )):
        samples = signal(category, duration, seed + 100 + i)
        fixture(root, manifest, f"environment-{i:02d}", category, samples, seed=seed + 100 + i)
    data = {"schema": SCHEMA, "dataset_id": f"synthetic-development-seed-{seed}",
            "split": "development", "clips": manifest}
    (root / "manifest.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data
