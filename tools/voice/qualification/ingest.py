"""Explicitly consented human WAV ingestion. Never uploads recordings.

Physical operators keep local data in a private, ignored directory. Consent
evidence is a locally maintained record ID, not the voice recording itself.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import shutil

from .manifest import SCHEMA, SPLITS, CATEGORIES, _id, inspect_wav, sha256


def ingest_human(
    input_path: Path, output_root: Path, *, split: str, clip_id: str,
    category: str, speaker_id: str, recording_source_id: str,
    source_family_id: str, session_id: str, consent_id: str,
    licence: str, source_description: str,
    wake_start_ms: float | None, wake_end_ms: float | None,
    consent_confirmed: bool,
) -> dict:
    if not consent_confirmed:
        raise ValueError("Explicit participant consent attestation required")
    if split not in SPLITS - {"development"}:
        raise ValueError("Consented recording must be assigned to training, tuning or acceptance")
    if not consent_id or not source_description or not licence:
        raise ValueError("Consent reference, licence and recording provenance required")
    for field, value in (
        ("clip_id", clip_id), ("speaker_id", speaker_id),
        ("recording_source_id", recording_source_id),
        ("source_family_id", source_family_id), ("session_id", session_id),
        ("consent_id", consent_id),
    ):
        _id(value, field)
    if category not in CATEGORIES:
        raise ValueError("Unknown recording category")
    if category == "wake":
        if (not isinstance(wake_start_ms, (float, int)) or
                not isinstance(wake_end_ms, (float, int)) or
                not math.isfinite(wake_start_ms) or
                not math.isfinite(wake_end_ms) or
                not 0 <= wake_start_ms < wake_end_ms):
            raise ValueError("Positive wake requires annotated onset and end")
    elif wake_start_ms is not None or wake_end_ms is not None:
        raise ValueError("Negative must not contain a positive wake region")
    input_path = Path(input_path)
    if input_path.is_symlink() or not input_path.is_file():
        raise ValueError("Input must be a regular local WAV")
    source_frames, _ = inspect_wav(input_path)
    if category == "wake" and wake_end_ms > source_frames * 1000 / 16000:
        raise ValueError("Wake annotation extends past source audio")
    root = Path(output_root)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    manifest_path = root / "manifest.json"
    if manifest_path.exists():
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        if data.get("schema") != SCHEMA or data.get("split") != split:
            raise ValueError("Cannot mix dataset versions or splits")
    else:
        data = {"schema": SCHEMA, "dataset_id": "consented-" + split + "-local",
                "split": split, "clips": []}
    filename = clip_id + ".wav"
    if filename != Path(filename).name or "/" in filename or "\\" in filename:
        raise ValueError("Unsafe clip ID")
    if any(row["id"] == clip_id or row["file"].casefold() == filename.casefold()
           for row in data["clips"]):
        raise ValueError("Duplicate human clip ID or filename")
    if not input_path.resolve().is_relative_to(root.resolve()):
        destination = root / filename
        if destination.exists():
            raise ValueError("Refusing to overwrite existing audio")
        with input_path.open("rb") as original, destination.open("xb") as copy:
            os.chmod(destination, 0o600)
            shutil.copyfileobj(original, copy)
    else:
        raise ValueError("Use a separate input and output root for traceable ingestion")
    frames, byte_length = inspect_wav(destination)
    entry = {
        "id": clip_id, "file": filename,
        "label": "positive" if category == "wake" else "negative",
        "category": category, "speaker_id": speaker_id,
        "session_id": session_id,
        "recording_source_id": recording_source_id,
        "source_family_id": source_family_id,
        "sha256": sha256(destination),
        "bytes": byte_length, "frames": frames,
        "wake_start_ms": wake_start_ms, "wake_end_ms": wake_end_ms,
        "provenance": {
            "kind": "consented-human", "license": licence,
            "source": source_description, "consent_id": consent_id,
            "permission_to_evaluate": True,
            "permission_to_redistribute": False,
        },
    }
    data["clips"].append(entry)
    # Never print or send audio, location, raw paths or consent document.
    temporary = root / "manifest.json.tmp"
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(manifest_path)
    return entry
