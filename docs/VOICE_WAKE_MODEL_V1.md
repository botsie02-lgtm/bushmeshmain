# BushMesh custom wake model V1 — experimental only

Base: bebfc1261797c7d87216bc54f5fb2a0ad2d7a795.
No microphone or Android changes. No production dependency, APK, activation or
radio destination/command/transmit capability. Vosk historical evidence:
unconstrained 0/4 positives; constrained 4/4 positives and 9/33 false-positive
negative clips. Neither is approved.

## Design and alternatives

Train from random initialization, binary acoustic classifier for "Hey BushMesh".
DS-CNN uses a strided stem, three depthwise/pointwise stages and coarse
time-frequency pooling, then a linear logit. Temporal alternative uses
frequency-strided stem and time-only convolutions, including dilation.
Both preserve coarse temporal order (unlike global average pooling).
Small-footprint DS-CNN evidence: https://doi.org/10.1186/s13636-020-00176-2 .
MFCC is compact but discards spectral detail; log-mel retains it for similar
sounding hard negatives. No proprietary feature extractor or pretrained weights.
Rolling overlapping windows trade compute for simple reproducible streaming;
future incremental FFT/TCN caches require parity checks. ONNX opset 17 portable
reference, ORT CPU single thread; native ORT mobile/minimal build or TFLite
conversion are alternatives pending device ABI, 16 KiB alignment and profiling.
Float32 first; static INT8 calibration on training data only and independent
threshold/accuracy/latency regression are future work. No claimed quantization.

## Contract for native specialist (not approved for production)

* Signed little-endian mono PCM16 at 16000 Hz. No resampling inside detector.
* Up to 1600 samples per feed, arbitrary fragmentation; score every 1600
  samples (100 ms), first score after 25600 samples (1.6 s). No EOF wake.
* 400-sample symmetric Hann window, 160-sample hop, 512 FFT, one-sided
  squared magnitude / 512, 40 unnormalized triangular HTK mel bands from
  80 to 7600 Hz. Natural log floor 1e-8; affine (log + 8)/8.
  PCM scaled by 32768. 158 frames. Input float32 [1,1,158,40] "logmel",
  output float32 [1,1] "wake_score", sigmoid (not calibrated probability).
* Threshold selected on tuning only: minimize false events, then misses,
  then prefer higher threshold. Zero detections is a possible failed candidate.
  Two consecutive scores >= threshold, 20-hop cooldown (2 s), must observe
  below-threshold score to rearm. No production threshold yet.
* Feed only while caller holds the audio lease. Reset clears all PCM, sample
  clock, cooldown, streak, pending samples and rearm state. On cancellation,
  focus loss, discontinuity, permission loss or session change caller MUST
  discard in-flight results and reset; never share detector across sessions.
  Caller owns real timestamps and session generation. Sample-clock event
  is end of last scored hop, not recognition of a destination or command.
* model.json identifies feature version, ONNX SHA256, threshold and provenance.
  Expected hash supplied independently from trusted review. Candidate metadata
  is not signed and threshold is not authenticated by the ONNX hash; a future
  production package must pin BOTH policy and model hash, validate complete
  manifest, runtime version and feature parity. Never trust adjacent metadata
  as a root of trust. No production loading here.

## Local corpus and consent

manifest.json is a JSON array. Each item: file (relative mono 16 kHz PCM16 WAV,
max 600 seconds), positive (boolean), split (train/tune/test), speaker
(pseudonymous stable ID), source_id (original recording ID, shared by all
derivatives), sha256 (hex file digest), rights (consented-commercial-training,
reviewed-commercial, or synthetic-research-only). Positive rows also require
start/end sample indices around exactly one phrase, <=25600 samples. Negative
recordings must not contain intended target; include hard negatives,
ordinary conversation, music and road/cabin noise with rights cleared.
For long negatives use segments <=600 s with common source ID.
No names, identifying metadata, audio or consent forms in Git; keep the consent
register locally. Obtain explicit consent for commercial ML training and
redistribution of resulting weights; separately review recording/music rights.
No automatic recordings or uploads. Manifest labels/rights are operator
attestations, not legal verification. Keep all sessions from a speaker together,
all original recording derivatives together, and ensure shared background source
does not cross splits. Validator rejects declared speaker/source/hash leakage;
cannot detect mislabelled IDs or hidden near-duplicates.
Train-only gain/time placement and additive white/smoothed noise augmentation.
Synthetic generation varies engine voice, pitch variant and speaking speed.
Synthetic voice groups split by base voice, not variants; all share one engine,
so independence is limited. Synthetic accents are not Australian human speech.
The historical Vosk fixture files are not used.

## Local reproducible commands (Linux Python 3.11)

    cd tools/voice/model
    python -m venv .venv
    source .venv/bin/activate
    pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
    pip install -r requirements.txt
    export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
    python -m unittest -v test_detector
    # Install espeak-ng and ffmpeg via OS packages for research fixtures only.
    python synthetic.py corpus
    python train.py corpus/manifest.json candidate-ds --architecture ds
    python train.py corpus/manifest.json candidate-temporal --architecture temporal

Use separate output directory per run (fails if exists). No network at runtime.
Both candidates export actual ONNX and verify PyTorch/ORT score parity.
Report includes byte size, SHA, parameter count, losses, tuning sweep, held-out
events, positive recall, per-event sample offset/latency relative to annotated
phrase end, false events per streamed negative hour, CPU/wall and process peak
RSS (includes training, not isolated inference). Negative exposure includes
fixed synthetic pre/post-roll; short separated clips are not continuous
field-hour evidence. Negative latency means before annotated end, not proof of
complete phrase recognition. Early/late events on positive clips visible in
details but not in negative-hour rate. Model selection across architectures
must use tuning, not held-out metrics; independent worker must use new locked
corpus. No human or vehicle performance claim.

## Rights ledger (not shipping approval)

* New model/training/feature code authored for this repository; ownership and
  distribution subject to repository/project terms. No copied model weights.
* PyTorch 2.5.1 BSD-style source: https://github.com/pytorch/pytorch/blob/v2.5.1/LICENSE .
  NumPy BSD-3-Clause: https://github.com/numpy/numpy/blob/v1.26.4/LICENSE.txt .
  ONNX Apache-2.0: https://github.com/onnx/onnx/blob/v1.17.0/LICENSE .
  ORT MIT: https://github.com/microsoft/onnxruntime/blob/v1.20.1/LICENSE .
  Exact wheel/AAR third-party notice inventory and redistribution review
  still required before binary shipment.
* eSpeak NG GPL-3-or-later https://github.com/espeak-ng/espeak-ng .
  FSF output guidance https://www.gnu.org/licenses/gpl-faq.html#GPLOutput :
  program licence ordinarily does not attach to output unless output contains
  protected program material. This does not establish rights to every voice
  or resulting weight; synthetic output is research-only pending review.
  FFmpeg used locally for resampling; binary configuration/licence varies,
  not shipped. No cloud TTS, access keys, MBROLA voices or paid service.
* No public datasets downloaded or used. Candidate negative data:
  https://mozilladatacollective.com/datasets/cmko7havo02f5nw07rbwwhowe
  lists Australian English Common Voice v24 subset as CC0; review exact
  dataset and terms https://commonvoice.mozilla.org/en/terms before use.
  Access through publisher, do not mirror raw data. Not target-positive data.
* No Vosk, sherpa, openWakeWord or other pretrained acoustic weights used.
  A BushMesh-owned from-scratch model is feasible with documented rights
  over code, all training material and contributor permissions; ownership
  and commercial redistribution are not certified merely by training it.
  All exported models explicitly redistribution_approved=false and
  operational_qualification=false. CI uploads metrics only, not weights/audio.

## Qualification handoff

Independent worker: lock candidate hash, feature version and operating policy
before unseen human Australian speakers, near-misses, sustained negatives
and road/cabin recordings. Measure recall, false wakes/hour with uncertainty,
latency, ARM64 real-time factor, PSS, thermals and battery. Establish acceptance
criteria before measuring. Native service worker receives contract only;
Master Coordination must approve any integration. No persistent microphone.
