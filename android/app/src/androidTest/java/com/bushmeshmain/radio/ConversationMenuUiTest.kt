package com.bushmeshmain.radio

import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.platform.app.InstrumentationRegistry
import com.bushmeshmain.MainActivity
import com.bushmeshmain.MainApplication
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
    // Start the real RN host. Radio is lazy-mounted; prepare the catalogue
    // while the app is still on its initial Drive tab.
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val host = (context.applicationContext as MainApplication).reactHost
    var fixtureStore: BushMeshPersistenceModule? = null
    var original: String? = null
    var fixtureSaved = false
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
      // Waiting for actual UI ensures the production React instance is running.
      await("Radio")
      val deadline = SystemClock.uptimeMillis() + 20_000
      var reactContext: ReactApplicationContext? = null
      while (reactContext == null && SystemClock.uptimeMillis() < deadline) {
        reactContext = host.currentReactContext as? ReactApplicationContext
        if (reactContext == null) SystemClock.sleep(100)
      }
      val store = BushMeshPersistenceModule(checkNotNull(reactContext) { "Live React application context unavailable" })
      fixtureStore = store
      original = nativeCall { store.loadChatPreferences(it) } as? String
      val entries = JSONObject()
      for ((slot, name) in listOf("Smoke Alpha", "Smoke Bravo").withIndex()) {
        val id = nativeCall { store.chatConfigurationId("synthetic-menu-fixture-" + slot, it) } as String
        val config = JSONObject().put("id", id).put("radio", "synthetic-offline-radio").put("slot", slot).put("name", name).put("privateChannel", true)
        entries.put(id, JSONObject().put("displayName", "").put("pinned", false).put("archived", false).put("unread", false)
          .put("localCreator", false).put("origin", "unknown").put("description", "").put("avatarColor", "lime").put("avatarIcon", "initials")
          .put("configuration", config).put("incarnation", 1).put("retired", false))
      }
      val fixture = JSONObject().put("version", 2).put("entries", entries).put("sort", "recent").toString()
      assertTrue(nativeCall { store.saveChatPreferences(fixture, it) } == true)
      fixtureSaved = true
      assertTrue("Encrypted catalogue readback mismatch", nativeCall { store.loadChatPreferences(it) } == fixture)
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
      // Restore only if the fixture actually wrote to the isolated store.
      if (fixtureSaved) {
        val store = checkNotNull(fixtureStore)
        val restored = original ?: "{\"version\":2,\"entries\":{},\"sort\":\"recent\"}"
        assertTrue("Protected catalogue restoration failed", nativeCall { store.saveChatPreferences(restored, it) } == true)
      }
    }
  }
}
