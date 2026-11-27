package com.bushmeshmain.radio

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.SystemClock
import com.bushmeshmain.MainActivity
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference

/** Fixture never opens AudioRecord and is never exposed to React. */
private class FixtureWakeCapture : WakeCapture {
  private var callback: ((WakeCaptureEvent) -> Unit)? = null
  override val drained = true
  var stops = 0
  override fun start(callback: (WakeCaptureEvent) -> Unit) {
    this.callback = callback
    callback(WakeCaptureEvent.Ready)
  }
  override fun stop(): Boolean { stops++; return true }
  fun syntheticWake() { callback?.invoke(WakeCaptureEvent.Detected(0.9)) }
}

class WakeServiceLifecycleTest : VoiceLifecycleFixture() {
  private val manager get() = requireNotNull(context.getSystemService(NotificationManager::class.java))
  private fun await(label: String, condition: () -> Boolean) {
    val deadline = SystemClock.uptimeMillis() + 15000
    while (SystemClock.uptimeMillis() < deadline) {
      if (condition()) return
      SystemClock.sleep(50)
    }
    fail("Timed out: " + label)
  }

  @Test fun realForegroundServiceNotificationStopAndStaleAction() {
    assertEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.RECORD_AUDIO))
    assertEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
    withRecognition { activity, _, module ->
      // Operational bridge remains unavailable even with all permissions.
      assertEquals(Pair(false,"BUSHMESH_WAKE_UNAVAILABLE"), call { module.activateHandsFree(it) })
      val owner = Any()
      val first = AtomicReference<WakeSnapshot>()
      val fixture = FixtureWakeCapture()
      try {
        instrumentation.runOnMainSync {
          assertTrue(HandsFreeRuntime.requestFixture(activity, owner, { fixture }, { first.set(it) }))
        }
        await("fixture listening state") { first.get()?.phase == WakePhase.LISTENING }
        await("persistent notification") { manager.activeNotifications.any { it.id == BushMeshHandsFreeService.NOTIFICATION_ID } }
        val note = manager.activeNotifications.first { it.id == BushMeshHandsFreeService.NOTIFICATION_ID }.notification
        assertTrue(note.flags and android.app.Notification.FLAG_ONGOING_EVENT != 0)
        assertTrue(note.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString().contains("test"))
        val stop = note.actions.single().actionIntent
        // Wake fixture exercises native handover; no app dialogue or send.
        instrumentation.runOnMainSync { fixture.syntheticWake() }
        await("scoped handover") { first.get()?.phase == WakePhase.HANDOVER }
        val key = checkNotNull(first.get().handover)
        instrumentation.runOnMainSync {
          assertFalse(VoiceAudioOwnership.microphoneBusy)
          assertTrue(HandsFreeRuntime.claim(owner, key))
          assertTrue(HandsFreeRuntime.owns(owner, key))
        }
        stop.send()
        await("notification stop") { first.get()?.phase == WakePhase.STOPPED }
        assertEquals(WakeReason.STOP_REQUESTED, first.get().reason)
        await("notification removed") { manager.activeNotifications.none { it.id == BushMeshHandsFreeService.NOTIFICATION_ID } }
        instrumentation.waitForIdleSync()
        instrumentation.runOnMainSync {
          assertFalse(HandsFreeRuntime.owns(owner, key))
          assertFalse(HandsFreeRuntime.complete(owner, key))
          assertFalse(VoiceAudioOwnership.microphoneBusy)
        }

        val second = AtomicReference<WakeSnapshot>()
        val next = FixtureWakeCapture()
        // Service destruction may follow notification removal asynchronously.
        await("service detached") {
          var detached = false
          instrumentation.runOnMainSync { detached = HandsFreeRuntime.snapshot(owner) == null }
          detached
        }
        instrumentation.runOnMainSync {
          assertTrue(HandsFreeRuntime.requestFixture(activity, owner, { next }, { second.set(it) }))
        }
        await("second fixture ready") { second.get()?.phase == WakePhase.LISTENING }
        stop.send() // immutable, session-scoped action cannot stop the new session
        instrumentation.waitForIdleSync()
        assertEquals(WakePhase.LISTENING, second.get().phase)
        instrumentation.runOnMainSync { assertTrue(HandsFreeRuntime.stop(owner, WakeReason.INVALIDATED)) }
        await("invalidation") { second.get()?.phase == WakePhase.STOPPED }
        assertEquals(WakeReason.INVALIDATED, second.get().reason)
      } finally {
        instrumentation.runOnMainSync { HandsFreeRuntime.stop(owner, WakeReason.INVALIDATED) }
        instrumentation.waitForIdleSync()
      }
    }
  }
}

/** Cold process / invalid intent has no activation grant; no model or fixture restored. */
class WakeServiceColdStartTest : VoiceLifecycleFixture() {
  @Test fun noRestoreOrActivationFromForgedStart() {
    withRecognition { activity, _, module ->
      val manager = requireNotNull(context.getSystemService(NotificationManager::class.java))
      assertEquals(Pair(false,"BUSHMESH_WAKE_UNAVAILABLE"), call { module.activateHandsFree(it) })
      instrumentation.runOnMainSync {
        activity.startService(Intent(activity, BushMeshHandsFreeService::class.java)
          .setAction(BushMeshHandsFreeService.START).putExtra(BushMeshHandsFreeService.EXTRA_ID, "obsolete-grant"))
      }
      instrumentation.waitForIdleSync()
      SystemClock.sleep(500)
      val status = call { module.getHandsFreeStatus(it) }.second as com.facebook.react.bridge.ReadableMap
      assertFalse(status.getBoolean("available"))
      assertFalse(status.getBoolean("active"))
      assertFalse(status.getBoolean("captureActive"))
      assertTrue(manager.activeNotifications.none { it.id == BushMeshHandsFreeService.NOTIFICATION_ID })
      instrumentation.runOnMainSync { assertFalse(VoiceAudioOwnership.microphoneBusy) }
    }
  }
}
