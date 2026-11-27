package com.bushmeshmain.radio

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.bushmeshmain.MainActivity
import com.bushmeshmain.MainApplication
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
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
  protected fun withRecognition(test: (BushMeshSpeechRecognitionModule) -> Unit) {
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    try {
      val host = (context.applicationContext as MainApplication).reactHost
      val deadline = SystemClock.uptimeMillis() + 20_000
      var react: ReactApplicationContext? = null
      while (react == null && SystemClock.uptimeMillis() < deadline) {
        react = host.currentReactContext as? ReactApplicationContext
        if (react == null) SystemClock.sleep(100)
      }
      val module = BushMeshSpeechRecognitionModule(checkNotNull(react))
      try { test(module) } finally { module.invalidate(); instrumentation.waitForIdleSync() }
    } finally { instrumentation.runOnMainSync { activity.finish() } }
  }
}
class VoicePermissionDeniedTest : VoiceLifecycleFixture() {
  @Test fun permissionDenialNeverStartsMicrophone() {
    assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.RECORD_AUDIO))
    withRecognition { module ->
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
      assertFalse((call { module.getStatus(it) }.second as ReadableMap).getBoolean("listening"))
    }
  }
}
class VoiceSuspendedRecognitionTest : VoiceLifecycleFixture() {
  @Test fun grantedPermissionCannotStartSuspendedRecognition() {
    assertEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.RECORD_AUDIO))
    withRecognition { module ->
      // Invoke the actual native lifecycle callback; no fake microphone audio.
      module.onHostPause()
      assertEquals(Pair(false,"BUSHMESH_STT_PERMISSION"),call { module.recognizeOnce("en-AU",it) })
      repeat(3) { attempt ->
        assertEquals(Pair(false,"BUSHMESH_STT_PERMISSION"),call { module.recognizeHeld("en-AU","suspended-$attempt",it) })
      }
      val status = call { module.getStatus(it) }.second as ReadableMap
      assertFalse(status.getBoolean("listening"))
      assertFalse(status.getBoolean("foreground"))
      assertTrue(status.isNull("microphoneOwner"))
    }
  }
}
