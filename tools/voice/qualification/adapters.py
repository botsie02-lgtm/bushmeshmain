"""Detector-independent streaming seam. Exactly one start/finish per stream.

External detector wire v1: one JSON line request, one JSON line response.
No interpretation of filenames, expected labels or phrase text is provided to
the adapter. Timestamps are samples from the stream start at 16 kHz.
"""
from __future__ import annotations

import base64
from dataclasses import dataclass
import json
import math
import shlex
import subprocess
from typing import Protocol


@dataclass(frozen=True)
class WakeEvent:
    sample_index: int
    confidence: float | None = None


class StreamDetector(Protocol):
    def start(self, sample_rate: int) -> list[WakeEvent]: ...
    def accept(self, pcm16le: bytes, start_sample: int) -> list[WakeEvent]: ...
    def finish(self) -> list[WakeEvent]: ...
    def close(self) -> None: ...


class NoOpAdapter:
    """Valid zero-detection wiring baseline, NEVER a qualified detector."""
    def start(self, sample_rate: int) -> list[WakeEvent]:
        if sample_rate != 16000:
            raise ValueError("Expected 16 kHz stream")
        return []

    def accept(self, pcm16le: bytes, start_sample: int) -> list[WakeEvent]:
        return []

    def finish(self) -> list[WakeEvent]:
        return []

    def close(self) -> None:
        return None


WAKE_WORDS = (("hey", "bush", "mesh"), ("hey", "bushmesh"))


def qualified_vosk_endpoint(result: dict, confidence: float = 0.85) -> bool:
    """Same conservative whole-endpoint evidence policy as prior experiment."""
    text = tuple(result.get("text", "").lower().split())
    words = result.get("result", [])
    return (
        text in WAKE_WORDS and
        isinstance(words, list) and
        tuple(w.get("word") for w in words) == text and
        all(isinstance(w.get("conf"), (float, int)) and
            not isinstance(w.get("conf"), bool) and
            math.isfinite(w["conf"]) and confidence <= w["conf"] <= 1.0
            for w in words)
    )


class VoskEndpointAdapter:
    """Optional legacy comparison only; Vosk is full ASR, not custom KWS."""
    def __init__(self, model_directory: str, mode: str = "unconstrained"):
        if mode not in ("unconstrained", "grammar"):
            raise ValueError("Unknown Vosk mode")
        try:
            import vosk
        except ImportError as error:
            raise RuntimeError("Install optional evaluation dependency vosk==0.3.45") from error
        vosk.SetLogLevel(-1)
        self.vosk = vosk
        self.model = vosk.Model(model_directory)
        self.mode = mode
        self.rec = None
        self.last_sample = 0

    def start(self, sample_rate: int) -> list[WakeEvent]:
        if sample_rate != 16000:
            raise ValueError("Vosk model evaluation requires 16 kHz PCM")
        if self.rec is not None:
            raise ValueError("Stream already started")
        self.rec = (self.vosk.KaldiRecognizer(self.model, sample_rate)
                    if self.mode == "unconstrained" else
                    self.vosk.KaldiRecognizer(self.model, sample_rate,
                                               json.dumps(["hey bush mesh", "[unk]"])))
        self.rec.SetWords(True)
        self.last_sample = 0
        return []

    def accept(self, pcm16le: bytes, start_sample: int) -> list[WakeEvent]:
        if self.rec is None or start_sample != self.last_sample or len(pcm16le) % 2:
            raise ValueError("Out-of-order or malformed Vosk stream")
        self.last_sample += len(pcm16le) // 2
        if self.rec.AcceptWaveform(pcm16le):
            result = json.loads(self.rec.Result())
            if qualified_vosk_endpoint(result):
                return [WakeEvent(sample_index=self.last_sample)]
        return []

    def finish(self) -> list[WakeEvent]:
        if self.rec is not None:
            # The *forced EOF* recognition is NOT a live wake event.
            self.rec.FinalResult()
            self.rec = None
        return []

    def close(self) -> None:
        self.rec = None
        self.model = None


def _events(response: dict) -> list[WakeEvent]:
    if not isinstance(response, dict) or set(response) != {"events"} or not isinstance(response["events"], list):
        raise ValueError("Detector response must be an events list")
    events = []
    for raw in response["events"]:
        if not isinstance(raw, dict) or set(raw) != {"sample_index", "confidence"}:
            raise ValueError("Invalid detector event schema")
        sample = raw["sample_index"]
        confidence = raw["confidence"]
        if not isinstance(sample, int) or isinstance(sample, bool) or sample < 0:
            raise ValueError("Detector emitted invalid sample index")
        if confidence is not None and (not isinstance(confidence, (float, int)) or
                                       isinstance(confidence, bool) or
                                       not math.isfinite(confidence) or not 0 <= confidence <= 1):
            raise ValueError("Detector emitted invalid confidence")
        events.append(WakeEvent(sample_index=sample, confidence=confidence))
    return events


class ExternalJsonLinesAdapter:
    """Long-lived subprocess; NO shell, environment secrets or signal injection.

    Command receives only PCM samples, never labels/clip IDs/provenance. It
    must reply once per request and must avoid logging to stdout. Launch with
    --adapter-command 'python your_adapter.py --model /path'.
    """
    def __init__(self, command: str):
        args = shlex.split(command)
        if not args:
            raise ValueError("Empty adapter command")
        self.process = subprocess.Popen(
            args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1,
        )
        self.last_sample = 0
        self.started = False

    def _exchange(self, request: dict) -> list[WakeEvent]:
        if not self.process.stdin or not self.process.stdout or self.process.poll() is not None:
            raise RuntimeError("Detector process exited or pipes closed")
        self.process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
        self.process.stdin.flush()
        response = self.process.stdout.readline()
        if not response:
            raise RuntimeError("Detector process returned EOF without a response")
        return _events(json.loads(response))

    def start(self, sample_rate: int) -> list[WakeEvent]:
        if sample_rate != 16000 or self.started:
            raise ValueError("Invalid stream start")
        self.started = True
        self.last_sample = 0
        return self._exchange({"type": "start", "sample_rate": sample_rate, "protocol_version": 1})

    def accept(self, pcm16le: bytes, start_sample: int) -> list[WakeEvent]:
        if not self.started or start_sample != self.last_sample or len(pcm16le) % 2:
            raise ValueError("Noncontiguous audio to detector")
        self.last_sample += len(pcm16le) // 2
        return self._exchange({"type": "chunk", "start_sample": start_sample,
                               "pcm16le_b64": base64.b64encode(pcm16le).decode("ascii")})

    def finish(self) -> list[WakeEvent]:
        if not self.started:
            raise ValueError("Stream is not active")
        self.started = False
        return self._exchange({"type": "end", "last_sample": self.last_sample})

    def close(self) -> None:
        try:
            if self.process.poll() is None:
                self.process.terminate()
                self.process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=2)
        finally:
            if self.process.stdin:
                self.process.stdin.close()
            if self.process.stdout:
                self.process.stdout.close()
