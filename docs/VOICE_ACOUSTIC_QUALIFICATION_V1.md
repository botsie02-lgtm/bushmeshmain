# BushMesh — Independent offline wake acoustic qualification v1

**Owner:** independent simulation/reliability testing; no model training, app radio changes, microphone service activation, or threshold optimization.  
**Exact base:** `bebfc1261797c7d87216bc54f5fb2a0ad2d7a795`  
**Branch:** `test/voice-acoustic-qualification-v1`  
**Status:** development acoustic evaluation and regression infrastructure only. **No model has passed independent Australian in-vehicle acceptance.**

The separate wake-model worker owns acoustic training, quantization, Android packaging and inference. The native hands-free worker owns actual capture/lifecycle. This branch owns **dataset evidence, harness reliability, rejection gates, benchmark reports and physical acceptance procedures**. The approved native services, `VoiceAssistant`, application Radio UI, frozen Security v1, and Protocol v1 are untouched. Previous network simulator branches are untouched.

## Existing acoustic baseline and context

`docs/VOICE_WAKE_QUALIFICATION.md` and `tools/voice/qualify_wake_audio.py` are preserved. Earlier Vosk testing reported **0/4 positives** with unconstrained decoding and **4/4 positives plus 9/33 false activations on negatives** with constrained grammar; these figures are *previous small-sample synthetic evaluations*, not results for the newly generated v1 corpus. Vosk is offline **full speech recognition**, not a qualified custom keyword spotter. Its unconstrained decoder is not assumed to work from a successful APK build; its constrained grammar can spuriously label unrelated speech. An endpoint is accepted only on the full exact token sequence and word confidence ≥0.85, never a partial or forced EOF. The old historical results must never be combined arithmetically with the new corpus.

The independent CI generates real **TTS-produced audio PCM**, not human speech. It includes positives ("hey bush mesh"), hard negatives, sound-alike words, synthetic two-voice passenger dialogues, a simulated spoken radio bulletin, application-like spoken feedback, generated silence, original algorithmic music tones, procedurally generated engine/road-like noise and 45 seconds of continuous background sound. The generated tones/noise **do not reproduce actual tyres, wind, road surface, motor, radio leakage, microphone placement, stereo speakers, or Australian vehicle conditions**.

Synthetic fixture source: eSpeak NG + FFmpeg with exact seed `0xB05A` and explicit provenance in each fixture entry. Engine/voice licensing and output redistribution rights are **not independently cleared**. The files are generated *ephemerally within CI* and are **not bundled into any app, downloaded to a user, or uploaded as an artifact**. The per-file manifest includes `permission_to_redistribute=false`. CI downloads a pinned Vosk candidate model through the existing script, without turning that model or its native binaries into production dependencies.

## Detector-independent interface

Two evaluation entry points exist:

1. **Python class** implementing `start(sample_rate)`, `accept(pcm16le, start_sample)`, `finish()` and `close()`. `start` is called **once per continuous stream/condition**, not per phrase. Positive/negative labels are hidden from the model. `accept` receives raw mono 16-bit little-endian 16 kHz PCM chunks at contiguous sample offsets and returns zero or more `WakeEvent(sample_index, confidence | None)`; `finish` must not convert forced EOF into a wake. The actual Vosk comparison adapter uses only complete streaming endpoints.
2. **External process protocol v1**: long-lived subprocess (no shell), one UTF-8 JSON request per line and exactly one response line. Requests:
   - `{"type":"start","sample_rate":16000,"protocol_version":1}`
   - `{"type":"chunk","start_sample":0,"pcm16le_b64":"..."}`
   - `{"type":"end","last_sample":16000}`
   Replies: `{"events":[{"sample_index":14400,"confidence":0.95}]}` or `{"events":[]}`. The timestamps are sample offsets from **stream start**, not clip-local time. The subprocess receives **no file names, source identities, expected phrase text or labels**. Output is schema/ordering validated. Model status, threshold and declared inference API must be frozen *before* acceptance clips are accessed.

`tools/voice/qualification/example_adapter.py` is a deliberately silent no-op wire adapter, useful only for validating transport and frame continuity. A silent no-op always fails recall and must not be represented as a successful acoustic detector.

### Commands

All commands below run from the repository root using **Python 3.11+**. Standard-library-only validation, streaming, ingestion and synthetic lifecycle unit tests need no model download. The TTS generator additionally needs `espeak-ng` and `ffmpeg`. Optional Vosk comparison uses `vosk==0.3.45` and the previously pinned model.

```bash
python -m unittest discover -s tools/voice/qualification -p 'test_*.py' -v
python -m tools.voice.qualification.lifecycle_report out/voice/synthetic-lifecycle.json

# Development: only local synthesized speech and original generated signals.
python -m tools.voice.qualification.cli generate --out /tmp/bushmesh-voice-dev --seed 0xB05A
python -m tools.voice.qualification.cli validate \
  --manifest /tmp/bushmesh-voice-dev/manifest.json --require-coverage

# Detector wiring baseline (zero wake events; NOT a successful model).
python -m tools.voice.qualification.cli evaluate \
  --manifest /tmp/bushmesh-voice-dev/manifest.json \
  --adapter noop --conditions clean,snr10,snr0 --seed 0x5101 \
  --report out/voice/noop.json

# External model worker: example only. Replace command with your real decoder.
python -m tools.voice.qualification.cli evaluate \
  --manifest /tmp/bushmesh-voice-dev/manifest.json \
  --adapter external \
  --adapter-command 'python -m tools.voice.qualification.example_adapter' \
  --conditions clean --report out/voice/example.json

# Real offline Vosk benchmark, only after existing pinned-model provisioning.
python tools/voice/qualify_wake_audio.py provision /tmp/bushmesh-pinned-model
python -m tools.voice.qualification.cli evaluate \
  --manifest /tmp/bushmesh-voice-dev/manifest.json \
  --adapter vosk \
  --model /tmp/bushmesh-pinned-model/vosk-model-small-en-us-0.15 \
  --vosk-mode unconstrained --conditions clean,snr10 \
  --report out/voice/vosk-unconstrained.json

# Longer continuous negative stress. Repetition is NOT independent exposure.
python -m tools.voice.qualification.cli evaluate \
  --manifest /tmp/bushmesh-voice-dev/manifest.json \
  --adapter external --adapter-command 'your-own-kws-adapter --model /path' \
  --negative-loop-hours 3 --chunk-ms 100 --seed 0x5101 \
  --report out/voice/three-hour-repeated-synthetic.json
```

Use a new clean `--out` folder per generation; generator intentionally refuses to overwrite an existing manifest.

### Actual acoustic measurements

Each whole-condition report contains per-stream true positives / misses, true-positive rate, 95% Wilson interval, false activation count, observed false events per **non-wake audio hour**, one-sided 95% Poisson upper bound (zero-count: `-ln(0.05)/hours`), duplicate wake events, median and 95th-percentile detection latency relative to the annotated end of the spoken wake phrase, clipping count, total samples, host CPU/wall times, host peak resident memory, audio real-time factor and exact stream start/finish counts. Each noise condition `clean`, `snr10`, `snr0`, etc. creates its own uninterrupted stream, never a fresh recognizer for every phrase. Deterministically seeded additive white Gaussian noise is an *augmentation*, not measured in-car acoustics.

Positive windows are anchored to onset and endpoint annotations and capped at the end of that clip; duplicate events in the same positive window count as duplicates, and wake-like events outside windows count as false activations. Negative hours exclude positive matching windows; repetitions of the same recording are not statistically independent. **Zero false wakes in five minutes gives an approximate one-sided 95% upper bound of 36 false activations/hour**, not zero. A report that contains only no-op detector zeros is a pipeline negative-control, never a qualification.

The results are descriptive. Host RSS, Python CPU, wall time, and synthesized PCM throughput **do not measure** Android memory/PSS, power consumption, audio capture, noise cancellation, Bluetooth/LoRa ownership, or hardware wake response.

## Dataset isolation and recording provenance

Manifest schema: `bushmesh-wake-qualification-manifest-v1`. Each clip declares immutable `id`, filename (simple relative .wav), `label`, `category`, pseudonymous `speaker_id` or null only for non-human non-speech, `session_id`, `recording_source_id`, `source_family_id`, SHA-256 hex, actual WAV byte/frame count, positive-only onset/endpoint milliseconds, and a strict provenance block: kind, license, source, consent ID, permission to evaluate and redistribution permission. Fixture ingest and validation accept **mono signed 16-bit PCM, 16,000 Hz only**; reject wrong encodings, truncated content, symlinks/traversal, SHA/byte/frame mismatch, missing consent, mislabeled positives, and incomplete category coverage when requested.

Partitions: `training`, `tuning`, `acceptance`, and synthetic `development`. Cross-partition validation rejects overlap in **speaker, recording session, recording source, source family and exact SHA-256 audio bytes**, not merely duplicated filenames. Synthetic audio is prohibited from the held-out **acceptance** partition. Actual acceptance evaluation refuses to run unless both training and tuning manifests are supplied for the leakage audit. It never trains a model or chooses an operating threshold; a trained detector must be frozen first. After an acceptance failure, fix architecture/hyperparameters on separate development and tuning data and create a genuinely new acceptance collection rather than cycling thresholds on the same holdout.

A positive source must be a *real participant saying the entire phrase in a natural way*, not a text label, fake sinusoid, machine prompt, or phrase carved from a model's training samples. Human recordings are **not in the repository**. The optional ingestion command requires explicit locally maintained consent documentation, separate speaker/recording/session IDs, recording rights, and `--confirm-consent`:

```bash
python -m tools.voice.qualification.cli ingest-consented \
  --input /private/input/wake-01.wav --out /private/acceptance-locked \
  --split acceptance --clip-id wake-01 --category wake \
  --speaker-id anon-speaker-01 --session-id session-01 \
  --recording-source-id recorder-01 --source-family-id record-day-01 \
  --consent-id signed-consent-01 --license participant-evaluation-only \
  --source-description 'AU English indoor parked vehicle, consented' \
  --wake-start-ms 600 --wake-end-ms 1600 --confirm-consent
```

This interface records an *operator attestation*, not independently verified legal consent. Keep original written consent securely offline, pseudonymise files and IDs, use privacy-preserving locations, and honour withdrawal. Never commit/upload raw audio, precise coordinates, raw transcripts, private keys, app message history, third-party broadcasts or actual acceptance recordings. The GitHub workflow uploads only **synthetic development manifest**, pinned model provenance, summarized scores and test-only synthetic lifecycle event traces, no WAV.

Run the cross-partition audit:

```bash
python -m tools.voice.qualification.cli validate \
  --manifest /private/train/manifest.json \
  --manifest /private/tune/manifest.json \
  --manifest /private/acceptance-locked/manifest.json --require-coverage
```

## Australian English physical recording protocol for Master Coordination

1. **Recruit real people:** informed consenting adults with genuinely different Australian English accents, ages and voices (do not infer personal characteristics from recordings). Use pseudonymous IDs, distinct sessions and different recording sources for train/tune/test. Target urban, regional and varied conversational delivery. Ask for normal speech, soft speech, raised voice, fast/casual delivery, and seated passenger delivery. A phone owner must confirm full consent and ability to withdraw.
2. **Rig and configuration:** Galaxy S22+ using documented microphone capture settings, Android version, app candidate SHA, sample format, model SHA, audio route, microphone permission/lifecycle. Record Heltec and LilyGo connectivity separately; the radio is **not** the microphone. Park safely, avoid interacting with a phone while driving, record legally and do not broadcast recordings. Do not include other people's voices, commercial radio or copyrighted music without appropriate rights.
3. **Phrases:** multiple isolated natural "Hey BushMesh" utterances per speaker and session. Include confusable negatives ("Hey bush", "Hey push mesh", "Hey brush mesh", "Hey bus mesh", "Hey bush mess"), similar phrases without the target, ordinary cabin conversations between consenting passengers, the existing assistant's own **lawfully generated** speech playback, loudspeaker echoes, genuine silence, ventilation and engine noise. For music/spoken radio use only explicitly licensed/self-authored material or consented actors reading original scripts. Label correct wake boundaries using manual audio review; never assume the spoken prompt aligns exactly to text.
4. **Environment:** obtain true physical recordings on the intended device in parked/controlled conditions: cabin quiet, window open, air conditioning, idle engine, gravel/bitumen road noise *only with a safely arranged qualified operator and legal recording consent*, phone orientation and pocket/mount positions, speaker playback and typical passenger chatter. TTS and procedural "road" noise must remain separate synthetic groups. Record measurement conditions without logging sensitive travel history.
5. **Isolate the locked holdout:** dedicate speakers, sessions, sources and entire recording days to acceptance; independently review source licenses, hashes and annotations before the model builder sees anything. The training worker receives only training/tuning partitions, never acceptance recordings, counts for particular failures, or threshold feedback.
6. **Stream without segment resets:** capture or replay continuous hours of negative exposure including transitions among silence, talk, radio, road noise, assistant playback, wake phrases and actual phone speaker feedback. Count ALL wake events and doubles, interruptions, and any recovery/reset caused by native lifecycle. A periodic service restart, crash, or permission change must be flagged—not treated as benign new independent sessions.
7. **ARM64 real-device instrumentation:** record warm/cold detector start, real end-of-phrase latency, microphone/audio route loss, model load time, Android PSS peak, average/max CPU with thermal trend, screen-off power/battery over several hours, foreground notification, OS permission revocation, BLE/radio reconnection, and memory growth. Test native cancellation and wake-during-playback via the appropriate separately owned Android integration tests.
8. **Independent QA:** pre-register thresholds and evaluation code/source SHA. Produce redacted per-condition confusion table and uncertainty intervals plus total measured negative hours, speaker count, unique sessions, device/vehicle count, failure clips held privately. Report **BLOCKED/NOT RUN** for any missing physical sample or provider; do not hand a synthetic PASS to integration.

## Proposed staged gates — not established product guarantees

| Gate | Required independent evidence | Suggested threshold before advancing |
|---|---|---|
| **Development screen** | ≥100 consented, non-acceptance wake utterances from ≥10 voices, ≥3 hours diverse unique negative recordings; model frozen during test | ≥85% observed recall, Wilson 95% lower bound ≥75%, ≤1 observed false/hour and report 95% upper bound; all safety/lifecycle negatives pass |
| **Controlled physical trial** | ≥300 independent wake utterances, ≥20 AU-English speakers and ≥30 hours distinct negative audio across several cars/conditions; no training/tuning overlap | ≥95% recall with Wilson 95% lower bound ≥92%, **upper** one-sided 95% false activation rate ≤0.2/hour, 95th percentile end-of-phrase latency ≤1000 ms |
| **Field-operation candidate** | ≥1000 held-out wake utterances, ≥50 speakers, ≥100 hours of diverse unique negative audio from multiple vehicles, ≥24 hours real ARM64 continuous stability per device class, pre-registered acceptance plan | ≥98% observed recall with Wilson 95% lower bound ≥97%, one-sided 95% false activation upper ≤0.1/hour, 95th percentile latency ≤750 ms; no unintended transmissions or lifecycle safety failures |

These are **proposed** thresholds pending product safety review. False activation bounds assume effectively independent representative observations: duplicate loops or synthetic generated hours **cannot** meet the evidence requirement. Example: even **zero false events** needs ~15 hours for upper bound ≤0.2/hr, or ~30 hours for ≤0.1/hr. With nonzero events the required duration is longer. In addition, measure actual ARM64 battery, memory and thermal behavior before accepting any runtime; Node/Jest or CI-host memory measurements alone do not establish fitness. A single critical speech interruption or a wake directly triggering a radio transmit is a **hard safety fail**, regardless of aggregate detection scores.

## Lifecycle coverage and ownership limitations

The standalone `WakeLifecycleModel` and its 64-cycle seeded trace (seed `0xB05A`) assert duplicate suppression, wake during ordinary/critical playback, rapid cancellation, stale callbacks, conversation replacement, radio disconnect, microphone permission loss, service termination and repeated activation/deactivation. The model does not call a microphone or `VoiceAssistant`; it cannot prove the Android implementation actually behaves this way. The **existing** `voiceAssistant.test.ts`, `holdToTalk.test.ts`, `radioSpeechPolicy.test.ts` and `appRadioNativeStopLifecycle.test.ts` are rerun in the branch-specific workflow to test existing implementation boundaries, but the workflow does not perform new physical Android instrumentation.

**A passing workflow means the evaluation machinery and existing JS boundaries passed, NOT that "Hey BushMesh" can safely wake the app on the Galaxy S22+.**

## Practical final evidence record

Record: evaluation commit SHA, detector worker commit SHA and frozen model digest, architecture/quantization, audio licenses/recording consent, partition manifest SHA(s), speaker/session/source counts, exact test duration by category, positive counts, false positives and uncertainty bounds, duplicate wakes, latency distribution, SNR and physical vehicle conditions, CPU/PSS/battery, lifecycle/cancellation outcomes, operator sign-off, and separately **SIMULATED / SYNTHETIC AUDIO / REAL HUMAN AUDIO / ACTUAL DEVICE** evidence labels. Missing items are BLOCKED, never assumed PASS.
