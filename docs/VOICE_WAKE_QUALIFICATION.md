# Offline wake qualification — Vosk evaluation, not an operational feature

Approved parent: 993b194142f37aaf261ffad1ecfa8fbb8ff39f1d; workflow
45925736899 passed including real Android 16 activity suspension, revocation
and relaunch. Preserve that implementation and integration history.

## Engine decision

- Preferred dedicated engine: sherpa-onnx, Apache-2.0 runtime. Its English
  GigaSpeech 3.3M KWS weights are NOT cleared for commercial redistribution:
  https://github.com/k2-fsa/sherpa-onnx/issues/3760
  https://github.com/k2-fsa/sherpa-onnx/issues/3802
  https://github.com/k2-fsa/sherpa-onnx/issues/4235
  An issue comment reports a ModelScope README Apache statement; this is not
  a verified chain of rights for the exact release archive and training data.
- Evaluation choice: Vosk, Apache-2.0 source
  https://github.com/alphacep/vosk-api and separately the publisher's
  https://alphacephei.com/vosk/models entry for vosk-model-small-en-us-0.15
  (Apache-2.0, 40 MB, US English). Original publisher archive:
  https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
  expected SHA256 30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498
  corroborated by the unchanged archive mirror
  https://huggingface.co/rhasspy/vosk-models/blob/main/en/vosk-model-small-en-us-0.15.zip
  and independent release metadata. The workflow verifies the downloaded bytes;
  this is a pinned expected digest, not a claim of a locally downloaded file.
  Preserve the publisher's README/attribution and Apache licence in any
  eventual distribution. Host test uses vosk==0.3.45. Android candidate uses
  com.alphacephei:vosk-android:0.3.75 and net.java.dev.jna:jna:5.18.1, test only.
  The actual Maven POM explicitly declares Apache-2.0 and JNA 5.18.1 AAR:
  https://central.sonatype.com/artifact/com.alphacephei/vosk-android/0.3.75
  Native binary source/third-party notice inventory remains an open review
  concern: https://github.com/alphacep/vosk-api/issues/2072 .
  ABI and 16 KB page-size validation are required; a POM licence alone is
  not final shipping approval.
- openWakeWord's distributed pretrained wake weights have CC BY-NC-SA terms;
  not bundled. Porcupine custom keyword requires vendor terms and AccessKey.
  No purchase, account, noncommercial model, or remote recognition fallback.

## Evaluation boundary

Vosk is streaming offline full ASR, not a dedicated low-power KWS model.
Only a complete endpoint result matching exactly "hey bush mesh" (or
"hey bushmesh"), with matching per-word evidence and minimum word confidence
0.85, qualifies. Do not use partials or substring matching. Compare the
unconstrained decoder with a constrained grammar including [unk]; grammar
may force out-of-vocabulary audio into a wake phrase. No grammar variant
is approved for operational use. Model, runtime and acceptance policy are
independent qualification decisions.

The evaluation runs actual decoded PCM waveforms with positive and negative
phrases, clean and deterministic additive noise. Generated speech is
synthetic acoustic evidence, NOT human recordings, Australian-speaker
accuracy or physical vehicle testing. A separate manifest mode accepts
consented human 16 kHz PCM WAV fixtures (no automatic upload). No production
mic permission, FGS, model or detector activation is introduced in this
increment; the existing unavailable status remains truthful until an engine
passes review. An unqualified continuous recognizer is not a safe hands-free
session. No changes to the approved finite dialogue, radio, or other branches.

Next: establish positive detection and false-activation behaviour on
consented Australian speakers, test continuous road-noise negatives,
measure ARM64 CPU/PSS/thermal/battery, clear binary notices, and then
wire a non-sticky, explicitly activated microphone foreground service
to the existing leases and verified VoiceAssistant handover.
