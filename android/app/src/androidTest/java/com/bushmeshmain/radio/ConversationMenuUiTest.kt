package com.bushmeshmain.radio

import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.platform.app.InstrumentationRegistry
import com.bushmeshmain.MainActivity
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReactApplicationContext
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Isolated emulator only: populate the encrypted catalogue, never radio slots. */
class ConversationMenuUiTest {
  @Test fun actualTouchDismissalAndSwitchingOfflineCatalogueRows() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    check(context.packageName == "com.bushmeshmain.radioredesign")
    val store = BushMeshPersistenceModule(ReactApplicationContext(context))
    fun nativeCall(call: (PromiseImpl) -> Unit): Any? {
      val result = AtomicReference<Any?>()
      val done = CountDownLatch(1)
      val failure = AtomicReference(false)
      call(PromiseImpl(Callback { values -> result.set(values.firstOrNull()); done.countDown() },
        Callback { _ -> failure.set(true); done.countDown() }))
      assertTrue(done.await(10, TimeUnit.SECONDS))
      assertFalse("Protected fixture write failed", failure.get())
      return result.get()
    }
    val entries = JSONObject()
    for ((slot, name) in listOf("Smoke Alpha", "Smoke Bravo").withIndex()) {
      val id = nativeCall { store.chatConfigurationId("synthetic-menu-fixture-" + slot, it) } as String
      val config = JSONObject().put("id", id).put("radio", "synthetic-offline-radio").put("slot", slot).put("name", name).put("privateChannel", true)
      entries.put(id, JSONObject().put("displayName", "").put("pinned", false).put("archived", false).put("unread", false)
        .put("localCreator", false).put("origin", "unknown").put("description", "").put("avatarColor", "lime").put("avatarIcon", "initials")
        .put("configuration", config).put("incarnation", 1).put("retired", false))
    }
    val original = nativeCall { store.loadChatPreferences(it) } as? String
    assertTrue(nativeCall { store.saveChatPreferences(JSONObject().put("version", 2).put("entries", entries).put("sort", "recent").toString(), it) } == true)
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val automation = instrumentation.uiAutomation
    fun find(node: AccessibilityNodeInfo?, label: String): Rect? {
      if (node == null) return null
      if (node.contentDescription?.toString() == label || node.text?.toString() == label) {
        val rect = Rect()
        node.getBoundsInScreen(rect)
        if (node.isVisibleToUser && !rect.isEmpty) return rect
      }
      for (i in 0 until node.childCount) find(node.getChild(i), label)?.let { return it }
      return null
    }
    fun await(label: String): Rect {
      val deadline = SystemClock.uptimeMillis() + 20_000
      while (SystemClock.uptimeMillis() < deadline) {
        find(automation.rootInActiveWindow, label)?.let {return it}
        SystemClock.sleep(200)
      }
      error("UI action unavailable: " + label)
    }
    fun tap(label: String) {
      val r = await(label)
      val now = SystemClock.uptimeMillis()
      for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
        val event = MotionEvent.obtain(now, SystemClock.uptimeMillis(), action, r.exactCenterX(), r.exactCenterY(), 0)
        instrumentation.sendPointerSync(event)
        event.recycle()
      }
      instrumentation.waitForIdleSync()
    }
    try {
      tap("Radio")
      tap("Chat options Smoke Alpha")
      await("Close chat options")
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      tap("Chat options Smoke Bravo")
      tap("Close chat options")
      tap("Chat options Smoke Alpha")
      // Backdrop centre could be obscured by sheet, tap near its top instead.
      val backdrop = await("Dismiss conversation options")
      val now = SystemClock.uptimeMillis()
      for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
        val event = MotionEvent.obtain(now, SystemClock.uptimeMillis(), action, backdrop.exactCenterX(), (backdrop.top + 20).toFloat(), 0)
        instrumentation.sendPointerSync(event); event.recycle()
      }
      tap("Chat options Smoke Bravo")
      tap("Chat details")
      await("Back")
      tap("Back")
      tap("Chat options Smoke Alpha")
      tap("Close chat options")
    } finally {
      instrumentation.runOnMainSync { activity.finish() }
      // Test environment only. Restore the original encrypted catalogue or an empty one.
      nativeCall { store.saveChatPreferences(original ?: "{\"version\":2,\"entries\":{},\"sort\":\"recent\"}", it) }
    }
  }
}
