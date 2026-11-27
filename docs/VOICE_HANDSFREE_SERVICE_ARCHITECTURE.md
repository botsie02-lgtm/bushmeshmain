# Detector-independent Android hands-free service

## Scope and gate

Approved finite-voice source: 993b194142f37aaf261ffad1ecfa8fbb8ff39f1d.
Starting specialist head: bebfc1261797c7d87216bc54f5fb2a0ad2d7a795.
Both outstanding workflows completed before this implementation:
- 45928336242 / Android job 140274968959: 2 acoustic instrumentation tests
  passed, actual Android 16 x86_64 Vosk file decoding (not live microphone).
  Unconstrained: 0/4 wake, 0/33 false, 29,121 ms CPU, 156,986 KiB PSS.
  Grammar: 4/4 wake, 9/33 false, 3,253 ms CPU, 141,430 KiB PSS.
  Load 2,234 ms; model 41,205,931 archive bytes, 70,898,967 installed bytes.
  ARM64 ELF load segments min alignment 16,384; no ARM64 execution claim.
  App APK 55,151,038 bytes; evaluation test APK 86,511,719 bytes.
  Both decoder modes fail the operational gate. Do not adopt them.
- 45928336249 / Android job 140274978156: debug/JVM, release/instrumentation,
  permission denial, real activity suspension, revocation/relaunch passed.
  Exact baseline 55,125,062 bytes; feature 55,151,038; delta 25,976.
  Application 786/786 Jest, 125/125 suites, TS, changed-file lint passed;
  exact inherited VoiceReadinessPanel lint issue remained unchanged.

This assignment replaces the former restriction on implementing FGS
infrastructure before a real model is available. It does NOT enable capture:
QualifiedWakeDetector.provider is compiled as null; no runtime registry,
model package, synthetic operational wake event, JS override or cloud
fallback. getHandsFreeStatus remains unavailable and activateHandsFree rejects
BUSHMESH_WAKE_UNAVAILABLE before requesting a service. Only separate
specialist review and a source change can supply a qualified provider.

## Detector contract for the model specialist

WakeDetectorProvider: immutable modelId (version/hash identifier),
isModelReady() cheap synchronous offline integrity/readiness check; no
download, network or I/O-heavy work in this method. open() creates a fresh
WakeDetector on a dedicated worker. Input is 16 kHz mono signed PCM16,
one borrowed ShortArray, 1..320 samples, count authoritative. Partial frames
are possible; detector owns any strictly bounded processing state, must not
retain the input array or audio recording. Return WakeMatch(confidence)
only for an actual accepted "Hey BushMesh" detection, already evaluated
against model-specific threshold and temporal policy. Confidence must be
finite 0..1; no generic threshold is substituted for model qualification.
No detector callback thread, transcript, file, microphone, network or
radio authority. cancel() nonblocking, thread-safe against acceptPcm;
open/accept/close bounded. close once on worker; exceptions terminal.
Model source, licensing, digest, ABI and independent accuracy evidence
required before replacing null registry. No Vosk integration.

AndroidWakeCapture owns AudioRecord (VOICE_RECOGNITION, no forced SCO),
one nonblocking 320-sample frame, zeroes it, no PCM queue or persistence.
Main-looper capture lease and generation guard; synchronous stop/release
before lease release, separate worker-drain barrier before rearm. A global
worker reservation prevents accumulating workers across sessions; failed
release retains the microphone lease until process death rather than
overlapping capture. Startup/drain 10s deadlines, 3s progress watchdog.
Detector cancellation must be nonblocking; no Java mechanism can guarantee
termination of arbitrary stuck JNI code. No engine is approved here.
AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE is deliberately conservative; continuous
focus may interfere with car media, an explicit remaining field-design gate.
Loss/duck, route change, call audio mode, permission/notification loss,
silenced/muted microphone and capture/decoder errors are terminal, no retry.
Device topology and actual AudioRecord routing are observed without changing
Bluetooth or BLE ownership. Audio mode is not proof of all phone call states.

## Service lifecycle

Separate non-exported BushMeshHandsFreeService, microphone FGS type,
FOREGROUND_SERVICE_MICROPHONE plus existing RECORD_AUDIO/FGS permission.
API31+ supported boundary (app min API24); visible actual MainActivity plus
React RESUMED, unlocked interactive screen, granted RECORD_AUDIO, enabled
notifications (including POST_NOTIFICATIONS on API33+) and qualified model.
One-use UUID grant expires after 5s, in memory only; activity identity/epoch
rechecked at delivery. Explicit START intent consumes grant, promotes
microphone foreground service before allocating capture. No boot receiver,
stored activation, implicit start, restart policy or radio service change.
START_NOT_STICKY, stopWithTask, null/unknown/replayed starts rejected.
Separate persistent notification ID 4102, existing radio ID 4101 untouched.
Immutable Stop PendingIntent is scoped to session UUID; old notification
cannot stop a newer session. Explicit deactivate/invalidation and task removal
stop service; permission revocation may kill process. On restart no grant.
Startup result is acceptance of request, not evidence of microphone activity.
Notification and OS indicator remain authoritative.

## Ownership and application handover

All state and lease transitions on main looper. Starting -> listening only
after real capture/decoder readiness. Ordinary speech or explicit eligible
finite/held turn yields wake lease synchronously; critical speech retains
existing finite-turn interruption priority. No ordinary playback interrupts
an unrelated finite turn. Generation changes before stopping capture so
queued obsolete matches are ignored. Rearm only for original explicit
session, after worker drain and both audio leases observed idle plus 750ms
quiet tail. Terminal interruption requires new user activation.

Match -> release recorder/lease -> HANDOVER. Metadata event
BushMeshHandsFreeSessionState / subscribeHandsFreeSession; no audio or
transcript. NativeHandsFreeStatus fields: available, active, offlineModelReady,
backgroundCaptureSupported, backgroundCommandSupported, phase, reason,
foreground, permissionGranted, modelId, sessionId, handoverId,
handoverClaimed, captureActive, captureGeneration, captureStarts,
acceptedWakes, microphoneOwner, playbackActive. captureStarts counts
start invocations; lease/capture state is not acoustic proof. Events are
transition snapshots; poll getHandsFreeStatus for current shared audio flags.

Application worker: on HANDOVER with current immutable destination and
session, claimHandsFreeHandover({sessionId,handoverId}) exactly once;
disarm any old quick-send grant, run the existing VoiceAssistant finite
dialogue using recognizeHandsFreeOnce(key, locale) for EVERY recognition
turn (no unscoped fallback). Existing verified destination/confirmation/send
guards remain mandatory. Recheck key, app context, destination and lifecycle
across each await. Stop/foreground loss/expiry invalidates handover and
cancels only an associated pending native recognizer. Application must
cancel dialogue and speech on invalidation, and not execute further command
or send from obsolete scope. completeHandsFreeHandover(key) after dialogue
settles, or explicitly decline without claiming. No automatic authorization
from wake, no automatic location disclosure. 90s handover limit; expiry
terminates session. Claim/complete stale or wrong-owner token fails closed.
No app UI or controller changes here; existing app still cannot activate wake.

## Background finite recognition boundary

Android permits a microphone FGS started with while-in-use permission from a
visible activity to continue capture in background, but that is not a
guarantee of vendor RecognitionService behaviour or model support.
https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
https://developer.android.com/about/versions/14/changes/fgs-types-required
https://developer.android.com/media/optimize/audio-focus
https://developer.android.com/reference/android/speech/SpeechRecognizer
https://developer.android.com/reference/android/media/AudioRecordingConfiguration

Android 15+ focus requires top app or FGS; SpeechRecognizer is not designed
for continuous recognition. createOnDeviceSpeechRecognizer is still a
provider-owned finite service. BushMesh's approved activity-instance/epoch
admission remains unchanged, including on-device-only factory and 20s
timeout. Do not relax it merely because a microphone FGS exists. This
build suspends wake capture and invalidates handover on actual background,
locked/noninteractive screen; FGS can remain active with suspended
notification and rearm after foreground/idle if the original session is
valid. Both background capability flags false. No background UI launch.

Future alternative: separately qualified OfflineFiniteCommandProvider /
OfflineFiniteCommandTurn for a service-owned offline PCM finite turn; same
bounded PCM, exclusive microphone lease, cancellation/close and transient
text result contract. The implementation and service-owned finite admission
are intentionally absent. A future adapter must map finite text to the
same VoiceAssistant contract, independently validate screen-off/OS/device
behaviour, and preserve scope/confirmation. No competing dialogue engine.

## Tests and remaining limits

WakeSessionControllerTest uses deterministic synthetic captures/events,
not acoustic inference. Covers one-shot/expired grants, cold process,
model/permission/notification/foreground/call gates, lease release, stale
events, scoped handover, quiet tail, focus/route failures, timeout, stall,
release failure, synchronous invalidation. WakeServiceLifecycleTest uses
actual API36 foreground promotion, notification/Stop PendingIntent, actual
activity background/resume, invalidation and stale notification action.
Fixture entry is internal native only and restricted to isolated
.radioredesign package, no bridge/intent setter, uses non-recording fake
capture. Fixture notification clearly labelled. Cold-start tests reject
ungranted service start, ordinary bridge still unavailable. Shell harness
externally force-stops and revokes RECORD_AUDIO while fixture service active,
verifies ready marker and subsequent cold-start. Intentional process kill
is not claimed as a passing interrupted JUnit test. Retains all previous
finite lifecycle tests. CI results must be inspected at exact final SHA.

No actual qualified detector, physical mic capture, screen-off wake/command,
human audio, battery/thermal or car routing claim. Test production real
provider open/cancel bounds, physical release and noise before activation.
No new third-party runtime/model. No BLE owner, radio foreground service,
history, Security v2/W1, UI, or direct message submission changes.
