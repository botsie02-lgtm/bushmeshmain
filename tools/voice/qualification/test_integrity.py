"""Stdlib regression: no real people, model, microphone or audio downloads."""
from __future__ import annotations

from array import array
import copy
import json
from pathlib import Path
import tempfile
import unittest

from tools.voice.qualification.generate import write_wav
from tools.voice.qualification.manifest import (
    SCHEMA, inspect_wav, load_manifest, sha256, assert_disjoint, recording_summary,
)
from tools.voice.qualification.ingest import ingest_human


def make_manifest(root: Path, split: str = "development",
                  kind: str = "synthetic-tts") -> Path:
    root.mkdir(parents=True, exist_ok=True)
    rows = []
    for idx, category in enumerate(("wake", "silence")):
        path = root / f"case-{idx}.wav"
        write_wav(path, array("h", [800] * (16000 if idx == 0 else 32000)))
        frames, length = inspect_wav(path)
        rows.append({
            "id": f"sample-{idx}", "file": path.name,
            "label": "positive" if idx == 0 else "negative",
            "category": category,
            "speaker_id": "speaker-one" if (idx == 0 or kind == "consented-human") else None,
            "session_id": "session-" + str(idx),
            "recording_source_id": "source-" + str(idx),
            "source_family_id": "source-family-" + str(idx),
            "sha256": sha256(path), "frames": frames, "bytes": length,
            "wake_start_ms": 100 if idx == 0 else None,
            "wake_end_ms": 800 if idx == 0 else None,
            "provenance": {
                "kind": kind, "license": "test-only-local", "source": "bounded unit PCM",
                "consent_id": "consent-001" if kind == "consented-human" else None,
                "permission_to_evaluate": True,
                "permission_to_redistribute": False,
            },
        })
    manifest = root / "manifest.json"
    manifest.write_text(json.dumps({
        "schema": SCHEMA, "dataset_id": f"unit-{split}",
        "split": split, "clips": rows,
    }), encoding="utf-8")
    return manifest


class ManifestIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bushmesh-voice-integrity-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.file = make_manifest(self.root / "one")

    def test_pcm_and_digest_pass_without_external_tools(self):
        data = load_manifest(self.file)
        self.assertEqual(recording_summary(data)["clips"], 2)
        self.assertEqual(recording_summary(data)["synthetic_clips"], 2)

    def test_modification_of_pcm_invalidates_sha(self):
        fixture = self.file.parent / "case-1.wav"
        with fixture.open("ab") as stream:
            stream.write(b"unauthorised")
        with self.assertRaisesRegex(ValueError, "SHA256 mismatch|Frame/byte length mismatch"):
            load_manifest(self.file)

    def test_rejects_paths_and_symlink_escape(self):
        payload = json.loads(self.file.read_text())
        payload["clips"][1]["file"] = "../escape.wav"
        self.file.write_text(json.dumps(payload))
        with self.assertRaisesRegex(ValueError, "relative"):
            load_manifest(self.file)
        self.file = make_manifest(self.file.parent)
        fixture = self.file.parent / "case-1.wav"
        fixture.unlink()
        fixture.symlink_to(self.file.parent / "case-0.wav")
        with self.assertRaisesRegex(ValueError, "root|regular"):
            load_manifest(self.file)

    def test_rejects_false_pcm_properties(self):
        fixture = self.file.parent / "case-0.wav"
        raw = fixture.read_bytes()
        fixture.write_bytes(raw[:24] + (8000).to_bytes(4, "little") + raw[28:])
        with self.assertRaisesRegex(ValueError, "16000"):
            load_manifest(self.file)

    def test_rejects_missing_consent_for_human(self):
        data = json.loads(self.file.read_text())
        data["clips"][0]["provenance"]["kind"] = "consented-human"
        self.file.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "consent_id"):
            load_manifest(self.file)

    def test_acceptance_rejects_synthetic_or_missing_categories(self):
        data = json.loads(self.file.read_text())
        data["split"] = "acceptance"
        self.file.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "consented human"):
            load_manifest(self.file)
        self.file = make_manifest(self.file.parent, "acceptance", "consented-human")
        with self.assertRaisesRegex(ValueError, "Missing required coverage"):
            load_manifest(self.file, require_coverage=True)

    def test_cross_partition_speaker_source_and_hash_leakage(self):
        train = load_manifest(make_manifest(self.root / "train", "training", "consented-human"))
        tune = load_manifest(make_manifest(self.root / "tune", "tuning", "consented-human"))
        with self.assertRaisesRegex(ValueError, "leakage"):
            assert_disjoint([train, tune])
        # Demonstrate each overlap separately rather than trusting only the
        # duplicate speaker check.
        for field in ("speaker_id", "session_id", "recording_source_id",
                      "source_family_id", "sha256"):
            modified = copy.deepcopy(tune)
            for row in modified["clips"]:
                if field == "sha256":
                    row[field] = "e" * 64
                elif field == "speaker_id":
                    row[field] = "distinct-speaker"
                else:
                    row[field] = "distinct-" + row[field]
            modified["clips"][0][field] = train["clips"][0][field]
            # Other overlapping attributes are made unique, so failure is
            # specifically attributable to the one field under test.
            other = copy.deepcopy(train)
            with self.assertRaisesRegex(ValueError, "leakage"):
                assert_disjoint([other, modified])

    def test_consent_ingestion_rejects_unconfirmed_and_copies_private(self):
        target = self.root / "acceptance"
        input_file = self.root / "one" / "case-0.wav"
        kwargs = dict(
            split="acceptance", clip_id="human-positive-01", category="wake",
            speaker_id="speaker-01", recording_source_id="recording-01",
            source_family_id="family-01", session_id="session-01",
            consent_id="signed-record-01", licence="participant-evaluation-only",
            source_description="consented AU-English private recorder; no location",
            wake_start_ms=100, wake_end_ms=800,
        )
        with self.assertRaisesRegex(ValueError, "consent"):
            ingest_human(input_file, target, consent_confirmed=False, **kwargs)
        result = ingest_human(input_file, target, consent_confirmed=True, **kwargs)
        self.assertEqual(result["sha256"], sha256(input_file))
        self.assertTrue((target / "human-positive-01.wav").is_file())
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            ingest_human(input_file, target, consent_confirmed=True, **kwargs)


if __name__ == "__main__":
    unittest.main()
