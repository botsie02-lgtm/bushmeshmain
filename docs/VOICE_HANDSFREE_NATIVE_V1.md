# Native offline hands-free voice v1 — decision and integration contract

Base: `626fc26e09a07a8b1b90429009adcd6aa082c5ba`. Specialist branch only.
The existing foreground VoiceAssistant and verified destination/readback/send
contract remain authoritative. No radio transport, BLE, security, history,
location-disclosure or UI changes.

## 1. Decision before adding engines (2026-11-27)

Keep the existing Android API 31+ on-device recognizer and installed offline
TTS for **finite, foreground turns**, with native scoped ownership, cancellation
and partial-result support. Select sherpa-onnx keyword spotting as the preferred
next *evaluation* architecture, not a selected shipping model. No major runtime,
new permission, model, service or automatic wake activation is introduced here.

| Candidate | Runtime and model rights | Technical suitability and limitations |
|---|---|---|
| Android on-device SpeechRecognizer and TTS | OS/service supplied, not redistributed by BushMesh. No claim to license device vendor models. Only the strict on-device recognizer and installed non-network TTS voice are used. | Existing API31+ finite recognition, en-AU requested, actual installed language/accuracy device-dependent. Android explicitly warns against continuous recognition. No custom low-power wake detector or continuous restart loop. No background guarantee. |
| sherpa-onnx | Runtime source Apache-2.0. English KWS `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01` has separate weight/data/token/vocabulary rights; public issue #3760 requests explicit redistribution clarification. #4235 also raises English weight rights. Apache runtime licence does not resolve those rights. Do not download/bundle for shipping until provenance and written model terms verified. | Actual Android KWS demo and arm64 support. Streaming small Zipformer KWS, configurable keyword definitions; 3.3M parameter model label, not measured installed size. en-AU and "Hey BushMesh" false-trigger/rejection rates unknown. Need pin ABI/runtime/model, check Android 16 and 16 KB page support, measure size, PSS, CPU, power. |
| Vosk | Runtime Apache-2.0; official `vosk-model-small-en-us-0.15` separately listed Apache-2.0, 40 MB download. This is a viable licensing candidate, subject to exact archive hash, licence/notices and transitive dependency review. | Android ARM64 build source; lightweight *relative to full ASR*, vendor says small models generally require ~300 MB memory. Dynamic grammar may constrain phrases if words exist in model vocabulary. US English, not en-AU; not a validated low-power KWS. Need check actual "hey bush mesh" token coverage, release ABI/page alignment, false wakes, CPU/PSS/battery under continuous input. Not ruled out by licence. |
| openWakeWord | Project runtime Apache-2.0; published pretrained wake weights CC BY-NC-SA 4.0. Google embedding has separate Apache-2.0 terms. Reject included non-commercial wake weights. | Dedicated English wake scoring, custom model training possible with separately cleared data; Android ports are additional dependencies requiring review. No licensed BushMesh model or Android 16 measurements. |
| Picovoice Porcupine | Vendor SDK/engine and custom model access require AccessKey and terms review. Do not assume open-source wrapper licences cover the binaries, model, commercial rights or offline activation. | Native Android custom keyword SDK is a potential dedicated low-power option; offline entitlement/activation, package size, real Australian road-noise detection, Bluetooth and CPU/battery must be tested. No key/account or vendor dependency introduced. |

Primary references reviewed:
- https://developer.android.com/reference/android/speech/SpeechRecognizer
- https://developer.android.com/about/versions/14/changes/fgs-types-required
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- https://developer.android.com/about/versions/15/behavior-changes-15
- https://developer.android.com/media/platform/sharing-audio-input
- https://github.com/k2-fsa/sherpa-onnx (source licence/platforms)
- https://github.com/k2-fsa/sherpa-onnx/blob/master/android/README.md
- https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html
- https://github.com/k2-fsa/sherpa-onnx/issues/3760
- https://github.com/k2-fsa/sherpa-onnx/issues/4235
- https://github.com/alphacep/vosk-api
- https://github.com/alphacep/vosk-api/blob/master/android/lib/build-vosk.sh
- https://alphacephei.com/vosk/models
- https://github.com/dscripka/openWakeWord
- https://huggingface.co/davidscripka/openwakeword/blob/main/README.md
- https://picovoice.ai/docs/quick-start/porcupine-android/
- https://picovoice.ai/docs/faq/porcupine/

No source/vendor benchmark is a BushMesh device measurement. A model-free
increment cannot report real wake detection, false wakes, vehicle noise, or
continuous CPU/battery. Exact APK byte delta is not measured by this document.

## 2. Implemented native boundaries

`VoiceAudioOwnership` owns exclusive generation-scoped microphone and playback
leases on the main looper. Only a finite recognition turn obtains the microphone.
Ordinary speech is rejected while a microphone or critical speech owns audio;
critical speech cancels the exact current recognition lease and confirms release
before acquiring playback. A previous bridge cannot release another lease.
Focus-loss listeners are generation-scoped. No automatic capture restart.

The Android recognizer uses only `createOnDeviceSpeechRecognizer` (API 31+),
with `EXTRA_PREFER_OFFLINE`, en-AU unless explicitly selected otherwise, a fresh
recognizer per turn and 20-second deadline. No network recognizer fallback.
The existing API33+ language support probe distinguishes installed,
download-required and unknown; it does not download resources or prove accuracy.
A 500 ms eligibility watch is active **only during finite capture**. It terminates
on permission/foreground loss or call/communication audio mode. Native activity
pause, host destruction, bridge invalidation, focus loss and audio input/Bluetooth
audio endpoint removal cancel the turn. No Bluetooth SCO route is forced and no
BLE connection is touched. Endpoint removal is conservative; a route change
without a device removal/focus event is not guaranteed detectable. Android
privacy controls and model/provider errors are not bypassed.

Hold-to-talk uses `recognizeHeld(locale, requestId)`, `finishHeld(requestId,
cancel)` and the same recognizer; early release before onReadyForSpeech cancels.
Once ready, release requests stopListening; final result remains asynchronous.
Endpointing may finish before release. Cancel can still discard the pending
result after release. Legacy stop/cancel cannot accidentally cancel a scoped
held turn; host suspension cancels any turn. Partial callbacks, when supplied
by the actual recognizer, are scoped to the active request and capped; not
command input. No raw PCM retained, transmitted or logged by BushMesh.
No transcript persistence or logging added; partial text lives in the active
consumer callback only. Device-provided engines remain outside BushMesh's
audit boundary.

`nativeSpeechRecognition.getStatus()` exposes foreground, permissionGranted,
microphoneOwner, playbackActive, phase, and lastFailure in addition to old
fields. The microphone owner is a lease (not proof of actual acoustic input);
the platform privacy indicator remains authoritative. `subscribeSessionState`
receives metadata-only finite recognition transitions; use getStatus() for
initial/live playback state. No event is a wake event. Errors are explicit
bridge rejections. `checkLanguage` is the finite model readiness probe.

`getHandsFreeStatus()`: available=false, active=false, offlineModelReady=false,
backgroundCaptureSupported=false, reason=offline-wake-engine-not-provisioned
(on older builds native-session-unavailable). `activateHandsFree()` rejects
BUSHMESH_WAKE_UNAVAILABLE; `deactivateHandsFree()` is idempotent false, and
does not interrupt an unrelated finite turn. No fake activation, wake event
or simulated model readiness. Do not enable a listening UI based on bridge
presence.

## 3. Application integration

```ts
import {applicationHoldToTalk} from '../speech/applicationVoice';
import {nativeSpeechRecognition} from '../native/NativeSpeechRecognition';

// Explicit press-in only; the permission gate is generation-fenced in JS.
// Capture destination/draft scope independently, then validate before append.
const result = await applicationHoldToTalk.press('en-AU', partial => {
  // Display transient draft preview; never submit or log partial.
});
// result === null: cancelled/early release. Otherwise append reviewed text
// via existing VoiceAssistant/composer policy. Recheck captured scope/epoch.
// Explicit press-out: applicationHoldToTalk.release()
// Navigation/unmount/background/explicit cancel: applicationHoldToTalk.cancel()
```

Call press without awaiting in the gesture handler; release/cancel may run while
the promise is outstanding. Prevent another dialogue while a held gesture is
pending (native leases enforce capture exclusion; permission UX is application
owned). On native unsupported, disable hold; no fallback to an unscoped turn.
Partial is optional. No message destinations chosen, no MeshCore submission,
no auto-location or authorization changes. The existing controller remains the
only voice dialogue/confirmation and verified submission authority.

## 4. Microphone foreground service architecture (NOT activated)

Future real detector: explicit visible user action -> permission/model/licence
readiness -> non-exported separate microphone foreground service, promote with
type microphone and FOREGROUND_SERVICE_MICROPHONE (API34+), RECORD_AUDIO and
foreground-service permission; use notification with immutable Stop intent,
explain notification availability and OS mic indicator. No boot receiver,
persistent activation flag or sticky microphone restart. START_NOT_STICKY, no
restart after kill, service teardown releases only its audio lease. Do not reuse
the radio service's connectedDevice/location type or change its BLE ownership.
Android 14 while-in-use restrictions prevent most background starts; Android 15+
focus requires top app or FGS, not evidence of microphone permission.

Future session state: off -> explicit activation -> starting -> actual wake
capture -> accepted keyword -> stop/release detector -> finite command turn ->
speech output -> re-arm detector only if original session generation remains
explicitly active and eligible. Never capture while playback owns audio; critical
alerts preempt. Suspend/stop on permission revocation, call, focus loss, route
change, service failure, notification Stop, process death. No unbounded retries.
Future detector callbacks must carry the session generation and no raw audio.
Wake merely requests the existing VoiceAssistant finite dialogue; it must not
grant send/location permission. Do not add microphone FGS/permission until
a genuine detector and its notification/stop lifecycle can be exercised; this
branch intentionally has **no microphone FGS**, screen-off or background wake
capture. A fake idle service provides no benefit and misrepresents readiness.

## 5. Verification and remaining field gate

Deterministic JVM and Jest fixtures exercise scoped lease ownership, preemption,
stale release, repeated start/stop, pending-permission release, scoped partials,
native rejection, cancel-after-release and no retry. These are synthetic
contract tests, not recorded-audio keyword tests. Android lifecycle instrumentation
extends the existing denied/suspended tests to reject held turns and unavailable
wake activation; isolated API36 workflow compiles and runs these after explicit
permission grant/revocation and process relaunch. No recognizer model is assumed
present on an emulator. CI state must be independently checked at final SHA.

Before shipping hands-free:
1. Review exact KWS model and all artifacts (hash, licence, attribution, dataset
   provenance, commercial redistribution), ABI and 16KB alignment.
2. Measure real recorded Australian English positives and negatives including
   BushMesh's own TTS, passengers, music, road noise, quiet and Bluetooth car
   audio. Report false activations/hour, missed wakes, latency and confidence.
3. Test ARM64 Android 16 S22+/other actual phones, foreground and lock/background,
   calls, audio route removal, focus loss, permission denial/revocation, notification
   Stop, repeated activation/deactivation, kill/reboot. Verify no capture after
   explicit Stop, no stale event, no simultaneous capture/playback.
4. Test airplane mode with pre-installed en-AU resources and BLE manually enabled;
   no fallback, no unapproved transmission, no silent location disclosure.
5. Record baseline versus session CPU, PSS, model download/installed/APK bytes,
   idle/active energy and thermal behaviour over identical drive/idle traces.
   No measurements are invented. Native code changes only; zero new bundled
   model bytes/dependency packages. Do not approve operational background capture
   or physical reliability until this evidence exists.


## 6. Android 16 lifecycle instrumentation repair

Previous specialist head: `75192cf514b5f98cad11608dd635d50c824ad231`.
Workflow `45923884974`, Android job `140260732634`: debug and JVM tests,
release and instrumentation compilation, and permission-denied instrumentation
passed. Suspended recognition failed at VoiceLifecycleTest.kt:80
(expected BUSHMESH_STT_PERMISSION, actual BUSHMESH_STT_RECOGNITION).
The ordinary recognition assertion at line 78 preceded the failed held turn,
so the synthetic suspension initially worked but did not remain effective.
The old fixture registered an isolated module before waiting for actual
activity/React resume and manually invoked onHostPause without pausing the
Activity. Registration-time or real host-resume callbacks could arrive later
and blindly set the cached resumed flag true. The old log does not record the
exact callback order: this is a plausible race, not proof that the OS activity
was actually suspended or that acoustic capture occurred. The integration
base 626fc26e09a07a8b1b90429009adcd6aa082c5ba has the same shadow-state and
manual-pause fixture defect; report to Master Coordination for integration,
do not modify that branch.

Repair: current React lifecycle must be RESUMED and its current MainActivity
must independently be resumed, not finishing or destroyed. MainActivity tracks
foreground epoch on the main looper; each turn binds to the admitted activity
and epoch. Read live state for both command and held admission, immediately
before startListening, callbacks/results and the finite eligibility watchdog.
Lifecycle callbacks reconcile state synchronously on main; off-main callbacks
read live state on execution, never overwrite it. A late resume cannot
authorize a suspended activity and a late pause cannot invalidate the live
foreground status. Real activity transitions invalidate any previously admitted
epoch; module invalidation still cancels explicitly. No automatic restart.
Metadata counters count successful microphone claims and actual startListening
invocations, not sound, and contain no user content.

The revised instrumentation waits for actual activity monitor stage and React
context readiness, registers on main, backgrounds with moveTaskToBack, resumes
the task, repeats suspension, and finishes the activity. It injects stale resume
while suspended and stale pause while foreground. Both recognition entrypoints
must reject permission and leave claims/start counters at zero; an engine error
is not accepted as evidence of no start. No recorded audio is needed.

Preserved exact-baseline measurement from the failed workflow, which completed
its APK comparison independently after the instrumentation failure:
- Base 626fc26e09a07a8b1b90429009adcd6aa082c5ba: 55,125,062 bytes.
- Feature 75192cf514b5f98cad11608dd635d50c824ad231: 55,151,038 bytes.
- Increase: 25,976 bytes.
These values describe the previous SHA, not the lifecycle repair. Re-measure
the repaired APK in the new specialist run. No additional model or dependency
was added.
