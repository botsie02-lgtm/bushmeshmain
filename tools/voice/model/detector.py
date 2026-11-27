"""Experimental offline wake detector. No microphone, commands or radio access."""
import hashlib
import json
from pathlib import Path
import numpy as np

RATE = 16000
WINDOW = 25600
HOP = 1600
FRAME = 400
STEP = 160
FFT = 512
MELS = 40
FRAMES = 1 + (WINDOW - FRAME) // STEP
SHAPE = (1, 1, FRAMES, MELS)
VERSION = "bushmesh-wake-logmel-v1"

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def mel_bank():
    mel = lambda hz: 2595 * np.log10(1 + hz / 700)
    hz = lambda m: 700 * (10 ** (m / 2595) - 1)
    edges = hz(np.linspace(mel(80), mel(7600), MELS + 2))
    f = np.arange(FFT // 2 + 1) * RATE / FFT
    return np.maximum(0, np.minimum(
        (f[None, :] - edges[:-2, None]) / (edges[1:-1] - edges[:-2])[:, None],
        (edges[2:, None] - f[None, :]) / (edges[2:] - edges[1:-1])[:, None]
    )).astype(np.float32)

BANK = mel_bank()
TAPER = np.hanning(FRAME).astype(np.float32)

def features(pcm):
    """Exactly WINDOW signed int16 samples; no resampling or hidden normalization."""
    x = np.asarray(pcm)
    if x.shape != (WINDOW,) or x.dtype != np.int16:
        raise ValueError("expected 25600 mono int16 samples")
    frames = np.lib.stride_tricks.sliding_window_view(
        x.astype(np.float32) / 32768, FRAME)[::STEP]
    spectrum = np.abs(np.fft.rfft(frames * TAPER, n=FFT)) ** 2 / FFT
    logmel = np.log(np.maximum(spectrum @ BANK.T, 1e-8))
    return ((logmel + 8) / 8).astype(np.float32)[None, None, :, :]

class Detector:
    """Bounded PCM state; caller owns session, timestamps and microphone lease."""
    def __init__(self, score, threshold, consecutive=2, cooldown_hops=20):
        if not 0 < threshold < 1 or consecutive < 1 or cooldown_hops < 1:
            raise ValueError("invalid policy")
        self.score = score
        self.threshold = threshold
        self.consecutive = consecutive
        self.cooldown_hops = cooldown_hops
        self.reset()

    def reset(self):
        self.window = np.zeros(WINDOW, dtype=np.int16)
        self.pending = np.empty(0, dtype=np.int16)
        self.samples = self.streak = self.cooldown = 0
        self.armed = True

    def feed(self, pcm):
        """Accept <=100 ms per call. Returns scored hops with sample-clock events."""
        pcm = np.asarray(pcm)
        if pcm.ndim != 1 or pcm.dtype != np.int16 or len(pcm) > HOP:
            raise ValueError("expected <=1600 mono int16 samples")
        self.pending = np.concatenate((self.pending, pcm))
        if len(self.pending) < HOP:
            return []
        chunk, self.pending = self.pending[:HOP], self.pending[HOP:].copy()
        self.window[:-HOP] = self.window[HOP:]
        self.window[-HOP:] = chunk
        self.samples += HOP
        if self.samples < WINDOW:
            return []
        p = float(self.score(features(self.window)))
        if not np.isfinite(p) or not 0 <= p <= 1:
            self.reset()
            raise ValueError("invalid model score; session reset")
        self.cooldown = max(0, self.cooldown - 1)
        if p < self.threshold:
            self.streak = 0
            self.armed = True
        else:
            self.streak = min(self.consecutive, self.streak + 1)
        event = self.armed and self.cooldown == 0 and self.streak >= self.consecutive
        if event:
            self.armed = False
            self.cooldown = self.cooldown_hops
            self.streak = 0
        return [{"sample": self.samples, "score": p, "wake": event}]

def load_candidate(directory, expected_sha256):
    """Expected SHA must come from a trusted review, never the adjacent manifest."""
    import onnxruntime as ort
    directory = Path(directory)
    meta = json.loads((directory / "model.json").read_text())
    model = directory / "wake.onnx"
    if (meta["version"] != VERSION or meta["sha256"] != expected_sha256
            or digest(model) != expected_sha256 or meta["operational_qualification"] is not False):
        raise ValueError("unexpected candidate model")
    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model), sess_options=options,
                                   providers=["CPUExecutionProvider"])
    inp, out = session.get_inputs(), session.get_outputs()
    if (len(inp) != 1 or inp[0].name != "logmel" or inp[0].shape != list(SHAPE)
            or inp[0].type != "tensor(float)" or len(out) != 1
            or out[0].name != "wake_score" or out[0].shape != [1, 1]
            or out[0].type != "tensor(float)"):
        raise ValueError("model tensor contract mismatch")
    return Detector(lambda x: session.run(["wake_score"], {"logmel": x})[0][0, 0],
                    meta["threshold"])
