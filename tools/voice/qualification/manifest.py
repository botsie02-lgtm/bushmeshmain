"""Independent dataset gate: provenance, consent, PCM fidelity and split isolation.

Stdlib-only. This validator must run before ANY detector is loaded.
No audio is uploaded, normalized silently, or repurposed for training.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re
import stat
import wave

SCHEMA = "bushmesh-wake-qualification-manifest-v1"
SPLITS = {"development", "training", "tuning", "acceptance"}
KINDS = {"consented-human", "licensed-third-party", "synthetic-tts", "synthetic-signal"}
CATEGORIES = {
    "wake", "hard-negative", "similar-sounding", "passenger-conversation",
    "music", "spoken-radio", "continuous-background", "silence",
    "road-engine", "bushmesh-playback",
}
REQUIRED_NEGATIVES = CATEGORIES - {"wake"}
HEX = re.compile(r"^[0-9a-f]{64}$")
IDENTITY = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$")
SAMPLE_RATE = 16000
MAX_AUDIO_SECONDS = 1800
MAX_CLIPS = 50000


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _id(value: object, name: str) -> str:
    if not isinstance(value, str) or not IDENTITY.fullmatch(value):
        raise ValueError(f"Invalid {name}")
    return value


def inspect_wav(path: Path) -> tuple[int, int]:
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"Not a regular WAV fixture: {path.name}")
    if path.stat().st_size > 2 + SAMPLE_RATE * 2 * MAX_AUDIO_SECONDS + 200_000:
        raise ValueError("WAV size exceeds bounded streaming limit")
    try:
        with wave.open(str(path), "rb") as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(),
                    audio.getcomptype()) != (1, 2, SAMPLE_RATE, "NONE"):
                raise ValueError(f"Require mono 16-bit signed 16000 Hz PCM WAV: {path.name}")
            frames = audio.getnframes()
            if not 0 < frames <= SAMPLE_RATE * MAX_AUDIO_SECONDS:
                raise ValueError(f"Invalid WAV duration: {path.name}")
            if len(audio.readframes(1)) != 2:
                raise ValueError(f"Truncated WAV header/audio: {path.name}")
    except (wave.Error, EOFError) as exc:
        raise ValueError(f"Invalid PCM WAV: {path.name}") from exc
    return frames, path.stat().st_size


def load_manifest(manifest_path: Path, *, require_coverage: bool = False) -> dict:
    manifest_path = Path(manifest_path)
    root = manifest_path.resolve().parent
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or set(data) != {"schema", "dataset_id", "split", "clips"}:
        raise ValueError("Manifest must have exactly schema/dataset_id/split/clips")
    if data["schema"] != SCHEMA or data["split"] not in SPLITS:
        raise ValueError("Invalid manifest schema or split")
    _id(data["dataset_id"], "dataset_id")
    clips = data["clips"]
    if not isinstance(clips, list) or not 0 < len(clips) <= MAX_CLIPS:
        raise ValueError("Manifest must contain a bounded nonempty clip list")
    seen_ids, seen_names = set(), set()
    categories = set()
    for clip in clips:
        if not isinstance(clip, dict) or set(clip) != {
            "id", "file", "label", "category", "speaker_id", "session_id",
            "recording_source_id", "source_family_id", "sha256", "bytes",
            "frames", "wake_start_ms", "wake_end_ms", "provenance",
        }:
            raise ValueError("Missing/unknown required clip fields")
        identifier = _id(clip["id"], "clip.id")
        if identifier in seen_ids:
            raise ValueError("Duplicate clip ID")
        seen_ids.add(identifier)
        filename = clip["file"]
        if (not isinstance(filename, str) or filename != Path(filename).name
                or not filename.endswith(".wav") or filename.startswith(".")):
            raise ValueError("Clips must be simple relative .wav filenames")
        if filename.casefold() in seen_names:
            raise ValueError("Case-insensitive filename collision")
        seen_names.add(filename.casefold())
        path = root / filename
        # Resolve and enforce no escapes, including symlinked dataset roots.
        if path.resolve().parent != root or path.is_symlink():
            raise ValueError("Fixture path leaves dataset root")
        frames, bytes_used = inspect_wav(path)
        if clip["frames"] != frames or clip["bytes"] != bytes_used:
            raise ValueError(f"Frame/byte length mismatch: {filename}")
        expected_sha = clip["sha256"]
        if not isinstance(expected_sha, str) or not HEX.fullmatch(expected_sha):
            raise ValueError("Invalid fixture SHA256")
        if sha256(path) != expected_sha:
            raise ValueError(f"SHA256 mismatch: {filename}")
        category = clip["category"]
        if category not in CATEGORIES or clip["label"] not in ("positive", "negative"):
            raise ValueError("Invalid clip category or label")
        if (category == "wake") != (clip["label"] == "positive"):
            raise ValueError("Only wake category may be positive")
        categories.add(category)
        for field in ("session_id", "recording_source_id", "source_family_id"):
            _id(clip[field], field)
        if clip["speaker_id"] is not None:
            _id(clip["speaker_id"], "speaker_id")
        elif category in {"wake", "hard-negative", "similar-sounding",
                          "passenger-conversation", "spoken-radio", "bushmesh-playback"}:
            raise ValueError("Speech clips require pseudonymous speaker_id")
        start, end = clip["wake_start_ms"], clip["wake_end_ms"]
        if category == "wake":
            if (not isinstance(start, (int, float)) or isinstance(start, bool)
                    or not isinstance(end, (int, float)) or isinstance(end, bool)
                    or not math.isfinite(start) or not math.isfinite(end)
                    or start < 0 or start >= end or end > frames * 1000 / SAMPLE_RATE):
                raise ValueError("Positive clip requires valid wake onset/end in ms")
        elif start is not None or end is not None:
            raise ValueError("Negative clip cannot declare wake region")
        provenance = clip["provenance"]
        if not isinstance(provenance, dict) or set(provenance) != {
            "kind", "license", "source", "consent_id", "permission_to_evaluate",
            "permission_to_redistribute",
        } or provenance["kind"] not in KINDS:
            raise ValueError("Invalid recording provenance")
        if provenance["permission_to_evaluate"] is not True or not isinstance(
                provenance["permission_to_redistribute"], bool):
            raise ValueError("Explicit evaluation permission required")
        if not isinstance(provenance["license"], str) or not provenance["license"].strip():
            raise ValueError("Source license declaration required (UNKNOWN allowed only for local evaluation)")
        if not isinstance(provenance["source"], str) or not provenance["source"].strip():
            raise ValueError("Recording/generator provenance required")
        if provenance["kind"] == "consented-human":
            _id(provenance["consent_id"], "consent_id")
            if clip["speaker_id"] is None:
                raise ValueError("Human audio requires speaker ID")
        elif provenance["consent_id"] is not None:
            raise ValueError("Non-human/third-party consent_id must be null")
        if data["split"] == "acceptance" and provenance["kind"] != "consented-human":
            raise ValueError("Final held-out acceptance is reserved for explicitly consented human recordings")
    if require_coverage and (not CATEGORIES.issubset(categories)):
        raise ValueError("Missing required coverage categories: " + repr(sorted(CATEGORIES - categories)))
    if not any(c["label"] == "positive" for c in clips):
        raise ValueError("Dataset requires positive wake audio")
    if not any(c["label"] == "negative" for c in clips):
        raise ValueError("Dataset requires negative audio")
    return data


def assert_disjoint(manifests: list[dict]) -> None:
    """No speaker/session/recording/source-family/identical audio crosses splits.

    A synthetic generator family shared with training/tuning does not qualify as
    an independently sourced acceptance recording. This is a conservative gate.
    """
    if len({m["split"] for m in manifests}) != len(manifests):
        raise ValueError("Only one manifest per split can be compared")
    fields = ("speaker_id", "session_id", "recording_source_id",
              "source_family_id", "sha256")
    for a in range(len(manifests)):
        for b in range(a + 1, len(manifests)):
            left, right = manifests[a], manifests[b]
            for field in fields:
                x = {c[field] for c in left["clips"] if c[field] is not None}
                y = {c[field] for c in right["clips"] if c[field] is not None}
                overlap = x & y
                if overlap:
                    raise ValueError(
                        f"{left['split']} / {right['split']} leakage in {field}: "
                        f"{len(overlap)} overlapping value(s)")


def recording_summary(manifest: dict) -> dict:
    return {
        "dataset_id": manifest["dataset_id"], "split": manifest["split"],
        "clips": len(manifest["clips"]),
        "speakers": len({c["speaker_id"] for c in manifest["clips"] if c["speaker_id"]}),
        "recording_sources": len({c["recording_source_id"] for c in manifest["clips"]}),
        "categories": {category: sum(c["category"] == category for c in manifest["clips"])
                       for category in sorted(CATEGORIES)},
        "seconds": sum(c["frames"] / SAMPLE_RATE for c in manifest["clips"]),
        "synthetic_clips": sum(c["provenance"]["kind"].startswith("synthetic")
                               for c in manifest["clips"]),
        "consented_human_clips": sum(c["provenance"]["kind"] == "consented-human"
                                    for c in manifest["clips"]),
    }
