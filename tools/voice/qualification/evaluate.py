"""True continuous-stream scoring: one adapter start/finish per noise condition.

For each clip, the real PCM is fed in consecutive chunks. Neither expected
labels nor segment boundaries reach the detector. Deliberate negative looping
does not reset the detector; it is NOT independent human recording hours.
"""
from __future__ import annotations

from array import array
import hashlib
import math
import random
import resource
import statistics
import time
from pathlib import Path
import wave

from .adapters import WakeEvent, StreamDetector
from .manifest import SAMPLE_RATE, recording_summary


def stable_seed(seed: int, category: str, clip_id: str, occurrence: int) -> int:
    digest = hashlib.sha256(
        f"{seed}:{category}:{clip_id}:{occurrence}".encode("utf-8")
    ).digest()
    return int.from_bytes(digest[:8], "big")


def wilson(successes: int, trials: int, z: float = 1.95996398454) -> list[float] | None:
    if trials <= 0:
        return None
    p = successes / trials
    d = 1 + z * z / trials
    center = (p + z * z / (2 * trials)) / d
    radius = z * math.sqrt(p * (1-p) / trials + z*z/(4*trials*trials)) / d
    return [round(max(0, center-radius), 6), round(min(1, center+radius), 6)]


def _poisson_cdf(k: int, mean: float) -> float:
    if k < 0:
        return 0.0
    if mean == 0:
        return 1.0
    if mean > 500:
        # Normal continuity approximation only for large counts.
        return 0.5 * math.erfc(-(k + 0.5 - mean) / math.sqrt(2 * mean))
    term = math.exp(-mean)
    total = term
    for i in range(1, k + 1):
        term *= mean / i
        total += term
    return min(1, total)


def false_activations_interval(count: int, hours: float) -> dict:
    """One-sided 95% Poisson bounds for independent stationary counts.

    Correlated repeated generated background violates the independent
    exposure assumption; the numerical bound is descriptive ONLY.
    """
    if hours <= 0:
        return {"observed_per_hour": None, "upper_95_per_hour": None,
                "lower_95_per_hour": None}
    if count == 0:
        return {"observed_per_hour": 0, "upper_95_per_hour": round(-math.log(.05)/hours, 3),
                "lower_95_per_hour": 0}
    lo, hi = 0.0, max(4.0, count * 2.0)
    while _poisson_cdf(count, hi) > .05:
        hi *= 2
    for _ in range(70):
        mid = (lo + hi) / 2
        if _poisson_cdf(count, mid) > .05:
            lo = mid
        else:
            hi = mid
    upper = (lo + hi) / 2
    lo, hi = 0.0, count
    for _ in range(70):
        mid = (lo + hi) / 2
        if _poisson_cdf(count - 1, mid) > .95:
            lo = mid
        else:
            hi = mid
    lower = (lo + hi) / 2
    return {"observed_per_hour": round(count/hours, 4),
            "upper_95_per_hour": round(upper/hours, 3),
            "lower_95_per_hour": round(lower/hours, 3)}


def _rms(path: Path) -> float:
    total, samples = 0.0, 0
    with wave.open(str(path), "rb") as audio:
        while True:
            pcm = audio.readframes(16000)
            if not pcm:
                break
            values = array("h")
            values.frombytes(pcm)
            total += sum(float(x)*x for x in values)
            samples += len(values)
    return math.sqrt(total/samples) if samples else 0.0


def _augment(pcm: bytes, randomizer: random.Random, noise_sigma: float) -> tuple[bytes, int]:
    if noise_sigma <= 0:
        return pcm, 0
    samples = array("h")
    samples.frombytes(pcm)
    saturated = 0
    for index, value in enumerate(samples):
        raw = value + randomizer.gauss(0, noise_sigma)
        if raw > 32767 or raw < -32768:
            saturated += 1
        samples[index] = max(-32768, min(32767, round(raw)))
    return samples.tobytes(), saturated


def make_plan(manifest: dict, negative_loop_hours: float) -> list[dict]:
    """One loop of labeled development clips followed by only negatives.

    Missing categories and repeating a short sample never inflate evidence of
    independent recordings or speakers. The true exposure is always reported.
    """
    if not math.isfinite(negative_loop_hours) or not 0 <= negative_loop_hours <= 24:
        raise ValueError("Negative-loop hours must be between zero and 24")
    clips = list(manifest["clips"])
    negatives = [c for c in clips if c["label"] == "negative"]
    negative_seconds = sum(c["frames"] / SAMPLE_RATE for c in negatives)
    if negative_loop_hours:
        if not negatives:
            raise ValueError("No negative clips to loop")
        index = 0
        # Requested hours of NEGATIVE-only repetition, after the baseline pass.
        while negative_seconds < negative_loop_hours * 3600:
            selected = negatives[index % len(negatives)]
            clips.append(selected)
            negative_seconds += selected["frames"] / SAMPLE_RATE
            index += 1
    return clips


def _score(
    events: list[WakeEvent],
    positive_windows: list[tuple[float, float, float]],
    duration_s: float, dataset: dict, clip_occurrences: int,
    clipping_samples: int, processing: dict, condition: str,
    negative_loop_hours: float,
) -> dict:
    accepted = [False] * len(positive_windows)
    false_events: list[float] = []
    dup_events: list[float] = []
    latencies: list[float] = []
    for event in sorted(events, key=lambda e: e.sample_index):
        timestamp = event.sample_index / SAMPLE_RATE
        window_id = next((i for i, (begin, end, _wake_end) in enumerate(positive_windows)
                          if begin <= timestamp <= end), None)
        if window_id is None:
            false_events.append(timestamp)
        elif accepted[window_id]:
            dup_events.append(timestamp)
        else:
            accepted[window_id] = True
            latencies.append(1000 * (timestamp - positive_windows[window_id][2]))
    covered = 0.0
    for start, end, _ in positive_windows:
        covered += max(0, end - start)
    exposure_s = max(0, duration_s - covered)
    positives = len(positive_windows)
    tps = sum(accepted)
    tpr = tps/positives if positives else None
    upper = false_activations_interval(len(false_events), exposure_s / 3600)
    return {
        "condition": condition,
        "true_positives": tps,
        "false_negatives": positives - tps,
        "total_positive_utterances": positives,
        "true_positive_rate": round(tpr, 6) if tpr is not None else None,
        "true_positive_rate_wilson_95": wilson(tps, positives),
        "false_negative_rate": round(1-tpr, 6) if tpr is not None else None,
        "false_activations": len(false_events),
        "false_activation_rate": upper,
        "duplicate_wake_events": len(dup_events),
        "detection_latency_ms": {
            "samples": len(latencies),
            "median": round(statistics.median(latencies), 1) if latencies else None,
            "p95": round(sorted(latencies)[max(0, math.ceil(len(latencies)*.95)-1)], 1)
                   if latencies else None,
            "negative_latency_possible": True,
            "reference": "wake utterance end, with tolerance window",
        },
        "dataset": recording_summary(dataset),
        "stream_audio_seconds": round(duration_s, 3),
        "nonwake_exposure_hours": round(exposure_s/3600, 6),
        "source_independent_negative_hours": None,
        "negative_loop_hours_requested": negative_loop_hours,
        "clip_occurrences": clip_occurrences,
        "saturated_samples_after_augmentation": clipping_samples,
        "resource": processing,
        "not_operationally_qualified": True,
        "interpretation": (
            "Model-independent continuous test. TTS, generated noise and loops "
            "cannot prove real in-car false activation rate or AU-English recall. "
            "No positive evidence is inferred from a zero-event no-op baseline."
        ),
        "events_preview": {
            "false_seconds_first_25": [round(x, 3) for x in false_events[:25]],
            "duplicate_seconds_first_25": [round(x, 3) for x in dup_events[:25]],
            "wake_events_total": len(events),
        },
    }


def evaluate_stream(
    manifest: dict, root: Path, adapter: StreamDetector, *,
    condition: str = "clean", seed: int = 101, chunk_ms: int = 100,
    negative_loop_hours: float = 0.0,
) -> dict:
    if condition != "clean":
        try:
            noise_snr_db = float(condition.removeprefix("snr"))
        except ValueError as error:
            raise ValueError("Condition must be clean or snr{dB}, e.g. snr10") from error
        if not math.isfinite(noise_snr_db) or not -10 <= noise_snr_db <= 40:
            raise ValueError("Noise SNR must be -10 to +40 dB")
    else:
        noise_snr_db = None
    if not isinstance(chunk_ms, int) or chunk_ms < 20 or chunk_ms > 1000 or 1000 % chunk_ms:
        raise ValueError("Chunk milliseconds must divide 1000, between 20 and 1000")
    plan = make_plan(manifest, negative_loop_hours)
    chunk_frames = chunk_ms * SAMPLE_RATE // 1000
    offset_samples, clipping, chunk_count = 0, 0, 0
    positives: list[tuple[float, float, float]] = []
    events: list[WakeEvent] = []
    t0 = time.perf_counter()
    cpu0 = time.process_time()
    rss0 = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    try:
        events.extend(adapter.start(SAMPLE_RATE))
        for occurrence, clip in enumerate(plan):
            base = offset_samples / SAMPLE_RATE
            if clip["label"] == "positive":
                # Detection is valid from slight pre-onset to 1.5 s after
                # the spoken phrase end (for a streaming endpoint decoder).
                wake_start = base + clip["wake_start_ms"]/1000
                wake_end = base + clip["wake_end_ms"]/1000
                positives.append((max(0, wake_start - .15), wake_end + 1.5, wake_end))
            sigma = 0.0
            path = root / clip["file"]
            if noise_snr_db is not None:
                audio_rms = _rms(path)
                sigma = (audio_rms if audio_rms > 1 else 500) * 10 ** (-noise_snr_db/20)
            rng = random.Random(stable_seed(seed, condition, clip["id"], occurrence))
            with wave.open(str(path), "rb") as audio:
                while True:
                    pcm = audio.readframes(chunk_frames)
                    if not pcm:
                        break
                    pcm, saturated = _augment(pcm, rng, sigma)
                    clipping += saturated
                    start_sample = offset_samples
                    offset_samples += len(pcm) // 2
                    chunk_count += 1
                    new_events = adapter.accept(pcm, start_sample)
                    for event in new_events:
                        if not 0 <= event.sample_index <= offset_samples:
                            raise ValueError("Adapter event index outside processed audio")
                    events.extend(new_events)
        # Explicit stream end; adapter must not convert forced end-of-file into
        # a wake classification (Vosk comparator discards FinalResult).
        trailing = adapter.finish()
        if any(event.sample_index > offset_samples for event in trailing):
            raise ValueError("Adapter emitted post-stream future event")
        events.extend(trailing)
    finally:
        adapter.close()
    wall = time.perf_counter() - t0
    cpu = time.process_time() - cpu0
    processing = {
        "host": "Python process; not Android phone",
        "wall_seconds": round(wall, 3),
        "cpu_seconds": round(cpu, 3),
        "cpu_to_audio_ratio": round(cpu/(offset_samples/SAMPLE_RATE), 5)
                              if offset_samples else None,
        "real_time_factor": round(wall/(offset_samples/SAMPLE_RATE), 5)
                            if offset_samples else None,
        "host_peak_rss_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        "peak_rss_growth_kib": max(0, resource.getrusage(resource.RUSAGE_SELF).ru_maxrss-rss0),
        "chunk_ms": chunk_ms,
        "chunks_processed": chunk_count,
        "detector_start_calls": 1,
        "detector_finish_calls": 1,
        "per_phrase_resets": 0,
    }
    return _score(events, positives, offset_samples/SAMPLE_RATE, manifest,
                  len(plan), clipping, processing, condition, negative_loop_hours)
