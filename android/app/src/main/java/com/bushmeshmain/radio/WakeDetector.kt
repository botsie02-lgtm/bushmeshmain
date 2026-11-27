package com.bushmeshmain.radio

/** Provider supplied only by a separately reviewed, compiled-in detector.
 * Readiness is a cheap, offline, verified-model check, never a download.
 * A provider must not own audio input, network, files of recordings, or radio.
 */
internal interface WakeDetectorProvider {
  val modelId: String
  fun isModelReady(): Boolean
  /** Called on the dedicated worker; bounded, no network fallback. */
  fun open(): WakeDetector
}

internal data class WakeMatch(val confidence: Double)

/** 16 kHz mono signed PCM16, 1..320 samples per call. One worker, no queue.
 * The buffer is borrowed only for the duration of acceptPcm. Do not retain it.
 * Return only an actual accepted keyword decision for the qualified model.
 * cancel() is thread-safe, nonblocking and causes pending work to unwind;
 * close() runs once on the worker. No asynchronous detector callbacks.
 */
internal interface WakeDetector : AutoCloseable {
  fun acceptPcm(samples: ShortArray, count: Int): WakeMatch?
  fun cancel()
  override fun close()
}

/** Deliberately empty until Master Coordination approves a real detector.
 * No runtime registration, intent, fixture, preference or JS override.
 */
internal object QualifiedWakeDetector {
  val provider: WakeDetectorProvider? get() = null
}
