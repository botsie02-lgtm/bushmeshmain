package com.bushmeshmain.radio

import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioRouting
import android.media.MediaRecorder
import android.os.Handler
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** AudioRecord is owned here, not by the detector. No PCM persistence, queue,
 * network or BLE routing. One worker reservation survives service teardown
 * until native inference/close finishes; a stuck detector cannot spawn workers.
 */
internal class AndroidWakeCapture(
  private val audio: AudioManager,
  private val main: Handler,
  private val provider: WakeDetectorProvider,
) : WakeCapture {
  companion object {
    private val workerReserved = AtomicBoolean(false)
    private const val RATE = 16000
    private const val FRAME = 320
  }
  private val lock = Any()
  private val detector = AtomicReference<WakeDetector?>()
  @Volatile private var running = false
  @Volatile private var workerDone = true
  override val drained: Boolean get() = workerDone
  private var record: AudioRecord? = null
  private var focus: AudioFocusRequest? = null
  private var routing: AudioRouting.OnRoutingChangedListener? = null
  private var routeId: Int? = null

  override fun start(callback: (WakeCaptureEvent) -> Unit) {
    check(record == null && workerDone)
    check(workerReserved.compareAndSet(false, true))
    workerDone = false
    fun event(value: WakeCaptureEvent) { main.post { callback(value) } }
    try {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setOnAudioFocusChangeListener({ change ->
          if (change < 0) event(WakeCaptureEvent.Failed(WakeReason.FOCUS_LOST))
        }, main).build()
      focus = request
      if (audio.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
        event(WakeCaptureEvent.Failed(WakeReason.FOCUS_LOST))
        workerReserved.set(false); workerDone = true; return
      }
      val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      check(min in 1..131072)
      val input = AudioRecord.Builder()
        .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
        .setAudioFormat(AudioFormat.Builder().setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
        .setBufferSizeInBytes(maxOf(min, FRAME * 8)).build()
      record = input
      check(input.state == AudioRecord.STATE_INITIALIZED)
      val listener = AudioRouting.OnRoutingChangedListener { route ->
        val next = route.routedDevice?.id
        val old = routeId
        routeId = next
        if (old != null && next != old) event(WakeCaptureEvent.Failed(WakeReason.ROUTE_CHANGED))
      }
      routing = listener
      input.addOnRoutingChangedListener(listener, main)
      input.startRecording()
      check(input.recordingState == AudioRecord.RECORDSTATE_RECORDING)
      routeId = input.routedDevice?.id
      running = true
      Thread({
        var engine: WakeDetector? = null
        val frame = ShortArray(FRAME)
        try {
          if (!running) return@Thread
          val opened = provider.open()
          engine = opened
          detector.set(opened)
          if (!running) { opened.cancel(); return@Thread }
          event(WakeCaptureEvent.Ready)
          while (running) {
            // No inference inside this lock. Nonblocking bounded read permits
            // synchronous physical release before another audio lease is issued.
            val count = synchronized(lock) {
              if (!running) 0 else input.read(frame, 0, frame.size, AudioRecord.READ_NON_BLOCKING)
            }
            if (!running) break
            if (count < 0 || audio.isMicrophoneMute ||
                input.activeRecordingConfiguration?.isClientSilenced == true) {
              event(WakeCaptureEvent.Failed(WakeReason.CAPTURE_FAILED)); break
            }
            if (count == 0) { SystemClock.sleep(10); continue }
            val match = opened.acceptPcm(frame, count)
            frame.fill(0)
            if (match != null) {
              event(WakeCaptureEvent.Detected(match.confidence))
              // Do not continue feeding audio after an accepted endpoint.
              break
            }
          }
        } catch (_: Exception) {
          if (running) event(WakeCaptureEvent.Failed(WakeReason.DETECTOR_FAILED))
        } finally {
          frame.fill(0)
          detector.set(null)
          val closed = runCatching { engine?.close() }.isSuccess
          // If close fails, fail closed: do not permit another detector worker.
          if (closed) workerReserved.set(false)
          workerDone = closed
          if (!closed) event(WakeCaptureEvent.Failed(WakeReason.DETECTOR_FAILED))
        }
      }, "BushMeshWakePcm").apply { isDaemon = true }.start()
    } catch (error: Exception) {
      workerReserved.set(false); workerDone = true
      throw error
    }
  }

  override fun stop(): Boolean {
    running = false
    runCatching { detector.get()?.cancel() }
    val released = synchronized(lock) {
      val input = record
      if (input == null) true
      else {
        routing?.let { runCatching { input.removeOnRoutingChangedListener(it) } }
        runCatching { input.stop() }
        runCatching { input.release() }.isSuccess.also { if (it) record = null }
      }
    }
    routing = null
    focus?.let { runCatching { audio.abandonAudioFocusRequest(it) } }; focus = null
    return released
  }
}
