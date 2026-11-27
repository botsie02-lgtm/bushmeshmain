"""Streaming and statistical semantics; scripted events are NOT acoustic hits."""
from __future__ import annotations

import copy
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import shlex
import sys
import tempfile
import unittest

from tools.voice.qualification.cli import main as qualification_cli
from tools.voice.qualification.manifest import sha256
from tools.voice.qualification.adapters import (
    NoOpAdapter, ExternalJsonLinesAdapter, WakeEvent, _events, qualified_vosk_endpoint,
)
from tools.voice.qualification.evaluate import (
    evaluate_stream, false_activations_interval, make_plan, stable_seed, wilson,
)
from tools.voice.qualification.manifest import load_manifest
from tools.voice.qualification.test_integrity import make_manifest


class ScriptedDetector:
    """Timing oracle for scoring tests, deliberately never a real detector."""
    def __init__(self, at_samples: list[int]):
        self.at = list(at_samples)
        self.start_calls = 0
        self.end_calls = 0
        self.consumed = 0

    def start(self, sample_rate: int):
        assert sample_rate == 16000
        self.start_calls += 1
        return []

    def accept(self, pcm16le: bytes, start_sample: int):
        assert start_sample == self.consumed
        self.consumed += len(pcm16le)//2
        emitted = [WakeEvent(sample_index=i, confidence=0.9)
                   for i in self.at if start_sample <= i < self.consumed]
        return emitted

    def finish(self):
        self.end_calls += 1
        return []

    def close(self):
        pass


class StreamingScoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bushmesh-stream-test-")
        self.addCleanup(self.temp.cleanup)
        self.path = make_manifest(Path(self.temp.name))
        self.manifest = load_manifest(self.path)

    def test_noop_zero_events_is_failed_recall_not_a_pass(self):
        report = evaluate_stream(self.manifest, self.path.parent, NoOpAdapter(),
                                 condition="clean", seed=31, chunk_ms=100)
        self.assertEqual(report["true_positives"], 0)
        self.assertEqual(report["false_negatives"], 1)
        self.assertEqual(report["false_activations"], 0)
        self.assertGreater(report["false_activation_rate"]["upper_95_per_hour"], 0)
        self.assertTrue(report["not_operationally_qualified"])
        self.assertEqual(report["resource"]["per_phrase_resets"], 0)
        self.assertEqual(report["resource"]["detector_start_calls"], 1)

    def test_true_positive_duplicate_and_negative_false_activation(self):
        # 0.3s event is inside the wake clip, 0.4s duplicate, 1.5s
        # false activation on a separate negative recording.
        detector = ScriptedDetector([4800, 6400, 24000])
        report = evaluate_stream(self.manifest, self.path.parent, detector,
                                 condition="clean", chunk_ms=100)
        self.assertEqual(report["true_positives"], 1)
        self.assertEqual(report["false_negatives"], 0)
        self.assertEqual(report["duplicate_wake_events"], 1)
        self.assertEqual(report["false_activations"], 1)
        self.assertEqual(report["false_activations_by_category"]["silence"]["false_events"], 1)
        self.assertEqual(detector.start_calls, 1)
        self.assertEqual(detector.end_calls, 1)
        self.assertEqual(report["detection_latency_ms"]["median"], -500)
        self.assertGreater(report["false_activation_rate"]["upper_95_per_hour"],
                           report["false_activation_rate"]["observed_per_hour"])

    def test_negative_repetition_does_not_reset_detector(self):
        detector = ScriptedDetector([4800])
        r = evaluate_stream(self.manifest, self.path.parent, detector,
                            negative_loop_hours=0.002, chunk_ms=200, condition="snr10")
        self.assertEqual(detector.start_calls, 1)
        self.assertEqual(detector.end_calls, 1)
        self.assertEqual(r["total_positive_utterances"], 1)
        self.assertGreater(r["clip_occurrences"], 2)
        self.assertGreaterEqual(r["nonwake_exposure_hours"], 0.002)

    def test_seeded_augmentation_stable_and_condition_validated(self):
        self.assertEqual(stable_seed(9, "snr10", "x", 0),
                         stable_seed(9, "snr10", "x", 0))
        self.assertNotEqual(stable_seed(9, "snr10", "x", 0),
                            stable_seed(10, "snr10", "x", 0))
        one = evaluate_stream(self.manifest, self.path.parent, NoOpAdapter(),
                              condition="snr10", seed=123)
        two = evaluate_stream(self.manifest, self.path.parent, NoOpAdapter(),
                              condition="snr10", seed=123)
        self.assertEqual(one["saturated_samples_after_augmentation"],
                         two["saturated_samples_after_augmentation"])
        with self.assertRaisesRegex(ValueError, "Noise SNR"):
            evaluate_stream(self.manifest, self.path.parent, NoOpAdapter(), condition="snr100")

    def test_statistics_zero_count_does_not_claim_zero_rate(self):
        r = false_activations_interval(0, .25)
        self.assertEqual(r["observed_per_hour"], 0)
        self.assertAlmostEqual(r["upper_95_per_hour"], 11.983, places=2)
        self.assertEqual(wilson(0, 10)[0], 0)
        self.assertGreater(wilson(0, 10)[1], 0)
        self.assertEqual(wilson(10, 10)[1], 1)
        self.assertIsNone(wilson(0, 0))
        self.assertIsNone(false_activations_interval(0, 0)["observed_per_hour"])

    def test_adapter_rejects_invalid_timestamp_and_confidence(self):
        with self.assertRaisesRegex(ValueError, "invalid sample"):
            _events({"events": [{"sample_index": -1, "confidence": .9}]})
        with self.assertRaisesRegex(ValueError, "invalid confidence"):
            _events({"events": [{"sample_index": 1, "confidence": 1.2}]})
        with self.assertRaisesRegex(ValueError, "response"):
            _events({"event": []})

    def test_cli_pins_actual_dataset_manifest_digest_in_report(self):
        report_path = self.path.parent / "report.json"
        with redirect_stdout(io.StringIO()):
            code = qualification_cli([
                "evaluate", "--manifest", str(self.path),
                "--adapter", "noop", "--conditions", "clean",
                "--detector-id", "development-noop-001",
                "--report", str(report_path),
            ])
        self.assertEqual(code, 0)
        saved = json.loads(report_path.read_text())
        self.assertEqual(saved["dataset_manifest_sha256"], sha256(self.path))
        self.assertEqual(saved["detector"]["detector_id"], "development-noop-001")
        self.assertFalse(saved["held_out_acceptance"])
        self.assertFalse(saved["detector"]["operational_approval"])

    def test_external_json_lines_detector_stays_alive_for_continuous_stream(self):
        command = shlex.quote(sys.executable) + " -m tools.voice.qualification.example_adapter"
        result = evaluate_stream(self.manifest, self.path.parent,
                                 ExternalJsonLinesAdapter(command), condition="clean")
        self.assertEqual(result["true_positives"], 0)
        self.assertEqual(result["resource"]["detector_start_calls"], 1)
        self.assertEqual(result["resource"]["per_phrase_resets"], 0)

    def test_forced_eof_or_pre_pcm_wake_is_always_rejected(self):
        class BadEnd(ScriptedDetector):
            def finish(self):
                return [WakeEvent(sample_index=4800)]

        class BadStart(ScriptedDetector):
            def start(self, sample_rate):
                super().start(sample_rate)
                return [WakeEvent(sample_index=4800)]

        for bad in (BadEnd([]), BadStart([])):
            with self.assertRaisesRegex(ValueError, "before any PCM|end-of-file"):
                evaluate_stream(self.manifest, self.path.parent, bad)

    def test_vosk_whole_endpoint_rejects_partial_substrings_and_low_confidence(self):
        good = {"text": "hey bush mesh", "result": [
            {"word": "hey", "conf": .92}, {"word": "bush", "conf": .88},
            {"word": "mesh", "conf": .9},
        ]}
        self.assertTrue(qualified_vosk_endpoint(good))
        bad = copy.deepcopy(good)
        bad["text"] = "hey bush mesh send now"
        self.assertFalse(qualified_vosk_endpoint(bad))
        bad = copy.deepcopy(good)
        bad["result"][1]["conf"] = .79
        self.assertFalse(qualified_vosk_endpoint(bad))
        bad = copy.deepcopy(good)
        bad["result"][1]["word"] = "brush"
        self.assertFalse(qualified_vosk_endpoint(bad))


if __name__ == "__main__":
    unittest.main()
