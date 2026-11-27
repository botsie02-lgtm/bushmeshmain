"""Standalone offline CLI for independent wake-audio qualification."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import resource
import sys
import time

from .adapters import NoOpAdapter, VoskEndpointAdapter, ExternalJsonLinesAdapter
from .evaluate import evaluate_stream
from .generate import generate
from .ingest import ingest_human
from .manifest import HEX, _id, assert_disjoint, load_manifest, recording_summary, sha256


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Detector-neutral 16 kHz continuous audio qualification (NO live microphone)")
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("generate", help="Generate only synthetic DEVELOPMENT fixtures")
    make.add_argument("--out", type=Path, required=True)
    make.add_argument("--seed", type=lambda x: int(x, 0), default=0xB05A)
    validate = commands.add_parser("validate", help="Verify manifests, SHA256, PCM and leakage")
    validate.add_argument("--manifest", type=Path, action="append", required=True)
    validate.add_argument("--require-coverage", action="store_true")
    check = commands.add_parser("evaluate", help="Stream actual WAV PCM through a detector adapter")
    check.add_argument("--manifest", type=Path, required=True)
    check.add_argument("--training-manifest", type=Path)
    check.add_argument("--tuning-manifest", type=Path)
    check.add_argument("--adapter", choices=("noop", "vosk", "external"), default="noop")
    check.add_argument("--detector-id", help="Frozen adapter/model build identifier")
    check.add_argument("--detector-sha256", help="SHA-256 of the frozen model artifact (required for held-out acceptance)")
    check.add_argument("--adapter-command", help="Quoted command for persistent JSONL detector")
    check.add_argument("--model", type=Path, help="Offline Vosk model directory, only for legacy comparison")
    check.add_argument("--vosk-mode", choices=("unconstrained", "grammar"), default="unconstrained")
    check.add_argument("--conditions", default="clean,snr10",
                       help="Comma-separated clean/snr10/snr0; each is one continuous stream")
    check.add_argument("--chunk-ms", type=int, default=100)
    check.add_argument("--seed", type=lambda x: int(x, 0), default=0x51A700)
    check.add_argument("--negative-loop-hours", type=float, default=0)
    check.add_argument("--report", type=Path, required=True)
    ingest = commands.add_parser("ingest-consented", help="Copy one already consented human PCM WAV locally")
    ingest.add_argument("--input", type=Path, required=True)
    ingest.add_argument("--out", type=Path, required=True)
    ingest.add_argument("--split", choices=("training", "tuning", "acceptance"), required=True)
    ingest.add_argument("--clip-id", required=True)
    ingest.add_argument("--category", required=True)
    ingest.add_argument("--speaker-id", required=True)
    ingest.add_argument("--recording-source-id", required=True)
    ingest.add_argument("--source-family-id", required=True)
    ingest.add_argument("--session-id", required=True)
    ingest.add_argument("--consent-id", required=True)
    ingest.add_argument("--license", required=True)
    ingest.add_argument("--source-description", required=True)
    ingest.add_argument("--wake-start-ms", type=float)
    ingest.add_argument("--wake-end-ms", type=float)
    ingest.add_argument("--confirm-consent", action="store_true",
                        help="Operator attests signed/verifiable local consent for evaluation")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "generate":
        result = generate(args.out, args.seed)
        verified = load_manifest(args.out / "manifest.json", require_coverage=True)
        print(json.dumps({"generated": recording_summary(verified),
                          "source_kind": "synthetic-only; NOT independent acoustic acceptance",
                          "seed": args.seed}, indent=2))
    elif args.command == "validate":
        manifests = [load_manifest(path, require_coverage=args.require_coverage)
                     for path in args.manifest]
        assert_disjoint(manifests)
        print(json.dumps({"valid": True, "manifests": [
            {**recording_summary(x), "manifest_sha256": sha256(path)}
            for x, path in zip(manifests, args.manifest)
        ]}, indent=2))
    elif args.command == "ingest-consented":
        entry = ingest_human(
            args.input, args.out, split=args.split, clip_id=args.clip_id,
            category=args.category, speaker_id=args.speaker_id,
            recording_source_id=args.recording_source_id,
            source_family_id=args.source_family_id, session_id=args.session_id,
            consent_id=args.consent_id, licence=args.license,
            source_description=args.source_description,
            wake_start_ms=args.wake_start_ms, wake_end_ms=args.wake_end_ms,
            consent_confirmed=args.confirm_consent,
        )
        print(json.dumps({"ingested": entry["id"], "sha256": entry["sha256"],
                          "audio_uploaded": False}))
    elif args.command == "evaluate":
        data = load_manifest(args.manifest,
                             require_coverage=True if
                             (json.loads(args.manifest.read_text())["split"] == "acceptance")
                             else False)
        if data["split"] == "acceptance":
            if args.adapter == "noop":
                raise ValueError("No-op adapter cannot evaluate final held-out acceptance")
            if args.detector_id is None or args.detector_sha256 is None:
                raise ValueError("Final acceptance requires a frozen detector ID and SHA-256")
            if not HEX.fullmatch(args.detector_sha256):
                raise ValueError("Frozen detector SHA-256 must be 64 lowercase hexadecimal characters")
            _id(args.detector_id, "detector_id")
            if args.training_manifest is None or args.tuning_manifest is None:
                raise ValueError("Held-out acceptance requires both training and tuning manifests for leakage audit")
            train = load_manifest(args.training_manifest)
            tune = load_manifest(args.tuning_manifest)
            if train["split"] != "training" or tune["split"] != "tuning":
                raise ValueError("Expected training/tuning partition labels")
            assert_disjoint([train, tune, data])
        elif args.training_manifest or args.tuning_manifest:
            others = [load_manifest(path) for path in
                      (args.training_manifest, args.tuning_manifest) if path is not None]
            assert_disjoint(others + [data])
        if args.detector_id is not None:
            _id(args.detector_id, "detector_id")
        if args.detector_sha256 is not None and not HEX.fullmatch(args.detector_sha256):
            raise ValueError("Invalid frozen detector SHA256")
        if args.adapter == "vosk" and args.model is None:
            raise ValueError("Vosk adapter requires --model pointing to a verified offline model")
        if args.adapter == "external" and not args.adapter_command:
            raise ValueError("External adapter requires --adapter-command")
        conditions = [x.strip() for x in args.conditions.split(",")]
        if not conditions or len(conditions) > 6 or not all(conditions):
            raise ValueError("Conditions list must be 1–6 nonempty items")
        rows = []
        for condition in conditions:
            init_wall = time.perf_counter()
            init_cpu = time.process_time()
            init_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            adapter = (NoOpAdapter() if args.adapter == "noop" else
                       VoskEndpointAdapter(str(args.model), args.vosk_mode)
                       if args.adapter == "vosk" else
                       ExternalJsonLinesAdapter(args.adapter_command))
            setup_wall_ms = (time.perf_counter() - init_wall) * 1000
            setup_cpu_ms = (time.process_time() - init_cpu) * 1000
            setup_rss_growth = max(0, resource.getrusage(resource.RUSAGE_SELF).ru_maxrss - init_rss)
            row = evaluate_stream(
                data, args.manifest.resolve().parent, adapter,
                condition=condition, seed=args.seed,
                chunk_ms=args.chunk_ms, negative_loop_hours=args.negative_loop_hours,
            )
            row["resource"]["adapter_setup_wall_ms"] = round(setup_wall_ms, 3)
            row["resource"]["adapter_setup_cpu_ms"] = round(setup_cpu_ms, 3)
            row["resource"]["adapter_setup_peak_rss_growth_kib"] = setup_rss_growth
            rows.append(row)
        report = {
            "schema": "bushmesh-voice-continuous-acoustic-report-v1",
            "detector": {
                "adapter": args.adapter,
                "vosk_mode": args.vosk_mode if args.adapter == "vosk" else None,
                "detector_id": args.detector_id,
                "frozen_model_sha256": args.detector_sha256,
                "custom_model_identified": bool(args.detector_id and args.detector_sha256),
                "operational_approval": False,
            },
            "dataset": recording_summary(data),
            "dataset_manifest_sha256": sha256(args.manifest),
            "training_manifest_sha256": sha256(args.training_manifest) if args.training_manifest else None,
            "tuning_manifest_sha256": sha256(args.tuning_manifest) if args.tuning_manifest else None,
            "augmentation_seed": args.seed,
            "conditions": rows,
            "held_out_acceptance": data["split"] == "acceptance",
            "no_threshold_tuning_performed": True,
            "human_recordings_upload": False,
        }
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"report": str(args.report), "dataset": report["dataset"],
                          "results": [
                              {k: row[k] for k in ("condition", "true_positives",
                               "false_negatives", "false_activations",
                               "duplicate_wake_events", "false_activation_rate")}
                              for row in rows], "operational_approval": False}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, FileNotFoundError) as exc:
        print(f"QUALIFICATION REJECTED: {exc}", file=sys.stderr)
        sys.exit(2)
