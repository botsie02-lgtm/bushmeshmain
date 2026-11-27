package com.bushmeshmain.radio

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import com.bushmeshmain.MainActivity
import com.bushmeshmain.MainApplication
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.common.LifecycleState
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

abstract class VoiceLifecycleFixture {
  protected val instrumentation = InstrumentationRegistry.getInstrumentation()
  protected val context = instrumentation.targetContext
  protected fun call(block: (PromiseImpl) -> Unit): Pair<Boolean, Any?> {
    val value = AtomicReference<Any?>()
    val failed = AtomicReference(false)
    val latch = CountDownLatch(1)
    block(PromiseImpl(Callback { args -> value.set(args.firstOrNull()); latch.countDown() },
      Callback { args -> failed.set(true); value.set((args.firstOrNull() as? ReadableMap)?.getString("code")); latch.countDown() }))
    assertTrue("Voice bridge timed out", latch.await(10, TimeUnit.SECONDS))
    return Pair(!failed.get(), value.get())
  }
  protected fun awaitHostState(activity: MainActivity, react: ReactApplicationContext, foreground: Boolean) {
    val deadline = SystemClock.uptimeMillis() + 20_000
    var observed = ""
    while (SystemClock.uptimeMillis() < deadline) {
      var matches = false
      instrumentation.runOnMainSync {
        val stage = ActivityLifecycleMonitorRegistry.getInstance().getLifecycleStageOf(activity)
        val state = react.lifecycleState
        observed = "activity=$stage react=$state sameActivity=${react.currentActivity === activity}"
        matches = if (foreground) {
          stage == Stage.RESUMED && state == LifecycleState.RESUMED &&
            react.currentActivity === activity
        } else {
          (stage == Stage.PAUSED || stage == Stage.STOPPED || stage == Stage.DESTROYED) &&
            state != LifecycleState.RESUMED
        }
      }
      if (matches) return
      SystemClock.sleep(50)
    }
    fail("Timed out waiting for real foreground=$foreground: $observed")
  }

  protected fun status(module: BushMeshSpeechRecognitionModule): ReadableMap {
    val (ok, value) = call { module.getStatus(it) }
    assertTrue(ok)
    return value as ReadableMap
  }

  protected fun assertNeverAdmitted(module: BushMeshSpeechRecognitionModule, foreground: Boolean) {
    val state = status(module)
    assertEquals(foreground, state.getBoolean("foreground"))
    assertFalse(state.getBoolean("listening"))
    assertTrue(state.isNull("microphoneOwner"))
    assertEquals("idle", state.getString("phase"))
    assertEquals("No microphone lease acquired", 0.0, state.getDouble("microphoneClaims"), 0.0)
    assertEquals("No startListening invocation", 0.0, state.getDouble("startListeningRequests"), 0.0)
  }

  protected fun withRecognition(test: (MainActivity, ReactApplicationContext, BushMeshSpeechRecognitionModule) -> Unit) {
    val activity = instrumentation.startActivitySync(
      Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ) as MainActivity
    try {
      val host = (context.applicationContext as MainApplication).reactHost
      val deadline = SystemClock.uptimeMillis() + 20_000
      var react: ReactApplicationContext? = null
      while (react == null && SystemClock.uptimeMillis() < deadline) {
        react = host.currentReactContext as? ReactApplicationContext
        if (react == null) SystemClock.sleep(100)
      }
      val readyReact = checkNotNull(react)
      awaitHostState(activity, readyReact, true)
      // The isolated bridge has the same real React lifecycle listener as the
      // app module. Register on the main looper after the actual host is ready.
      val moduleRef = AtomicReference<BushMeshSpeechRecognitionModule>()
      instrumentation.runOnMainSync {
        moduleRef.set(BushMeshSpeechRecognitionModule(readyReact))
      }
      val module = checkNotNull(moduleRef.get())
      try {
        instrumentation.waitForIdleSync()
        assertNeverAdmitted(module, true)
        test(activity, readyReact, module)
      } finally {
        instrumentation.runOnMainSync { module.invalidate() }
        instrumentation.waitForIdleSync()
      }
    } finally {
      instrumentation.runOnMainSync { if (!activity.isDestroyed) activity.finish() }
      instrumentation.waitForIdleSync()
    }
  }
}
class VoicePermissionDeniedTest : VoiceLifecycleFixture() {
  @Test fun permissionDenialNeverStartsMicrophone() {
    assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.RECORD_AUDIO))
    withRecognition { _, _, module ->
      assertEquals(Pair(false,"BUSHMESH_STT_PERMISSION"),call { module.recognizeOnce("en-AU",it) })
      assertFalse((call { module.getStatus(it) }.second as ReadableMap).getBoolean("listening"))
      assertEquals(Pair(true,true),call { module.cancel(it) })
      assertEquals(Pair(false,"BUSHMESH_STT_PERMISSION"),call { module.recognizeHeld("en-AU","denied-held",it) })
      assertEquals(Pair(true,false),call { module.finishHeld("denied-held",false,it) })
      val status = call { module.getStatus(it) }.second as ReadableMap
      assertFalse(status.getBoolean("listening"))
      assertTrue(status.isNull("microphoneOwner"))
      assertFalse(status.getBoolean("permissionGranted"))
      val wake = call { module.getHandsFreeStatus(it) }.second as ReadableMap
      assertFalse(wake.getBoolean("available"))
      assertFalse(wake.getBoolean("active"))
      assertFalse(wake.getBoolean("offlineModelReady"))
      assertFalse(wake.getBoolean("backgroundCaptureSupported"))
      assertEquals("offline-wake-engine-not-provisioned", wake.getString("reason"))
      assertEquals(Pair(false,"BUSHMESH_WAKE_UNAVAILABLE"),call { module.activateHandsFree(it) })
      assertEquals(Pair(true,false),call { module.deactivateHandsFree(it) })
      assertNeverAdmitted(module, true)
    }
  }
}
class VoiceSuspendedRecognitionTest : VoiceLifecycleFixture() {
  private fun assertDenied(module: BushMeshSpeechRecognitionModule, suffix: String) {
    assertEquals(Pair(false,"BUSHMESH_STT_PERMISSION"), call { module.recognizeOnce("en-AU",it) })
    repeat(3) { attempt ->
      assertEquals(Pair(false,"BUSHMESH_STT_PERMISSION"),
        call { module.recognizeHeld("en-AU","suspended-$suffix-$attempt",it) })
      assertEquals(Pair(true,false), call { module.finishHeld("suspended-$suffix-$attempt",false,it) })
    }
    assertTrue(status(module).getBoolean("permissionGranted"))
    assertNeverAdmitted(module, false)
  }

  @Test fun grantedPermissionCannotStartSuspendedRecognition() {
    assertEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.RECORD_AUDIO))
    withRecognition { activity, react, module ->
      // A real task transition: Android pauses/stops MainActivity, and RN
      // reports a non-RESUMED context. Do not fake pause on a resumed host.
      instrumentation.runOnMainSync {
        assertTrue("Could not background the activity task", activity.moveTaskToBack(true))
      }
      awaitHostState(activity, react, false)
      assertDenied(module, "background")

      // Inject an obsolete resume notification from off-main while the real
      // host remains suspended. The main-queue callback must not reopen it.
      module.onHostResume()
      assertDenied(module, "late-resume")

      // Resume the actual task and verify status without using a recognizer
      // model. An obsolete pause cannot falsify the live foreground state.
      context.startActivity(Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
      awaitHostState(activity, react, true)
      assertNeverAdmitted(module, true)
      module.onHostPause()
      assertNeverAdmitted(module, true)

      // Repeat a genuine suspend/resume boundary. Finishing the host also
      // invalidates eligibility; no late callback may grant admission.
      instrumentation.runOnMainSync { assertTrue(activity.moveTaskToBack(true)) }
      awaitHostState(activity, react, false)
      assertDenied(module, "second-background")
      instrumentation.runOnMainSync { activity.finish() }
      awaitHostState(activity, react, false)
      module.onHostResume()
      assertDenied(module, "finished")
    }
  }
}
