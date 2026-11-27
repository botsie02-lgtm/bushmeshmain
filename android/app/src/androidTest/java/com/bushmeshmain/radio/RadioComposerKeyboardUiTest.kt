package com.bushmeshmain.radio

import android.content.Intent
import android.graphics.Rect
import android.graphics.Bitmap
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.WindowInsets
import android.widget.EditText
import java.io.File
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
class RadioComposerKeyboardUiTest {
  @Test fun visibleImeGeometryMultilineAndRoomDraftIsolation() {
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
    automation.serviceInfo = automation.serviceInfo.apply {
      flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
    }
    fun appRoot(): AccessibilityNodeInfo? = automation.windows.asSequence()
      .mapNotNull { it.root }.firstOrNull { it.packageName?.toString() == context.packageName }
      ?: automation.rootInActiveWindow?.takeIf { it.packageName?.toString() == context.packageName }
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
        find(appRoot(), label)?.let {return it}
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
    fun imeTop(): Int? {
      val value = AtomicReference<Int?>()
      instrumentation.runOnMainSync {
        val insets = activity.window.decorView.rootWindowInsets
        if (insets != null && insets.isVisible(WindowInsets.Type.ime())) {
          val bottom = insets.getInsets(WindowInsets.Type.ime()).bottom
          if (bottom > 0) value.set(activity.windowManager.currentWindowMetrics.bounds.bottom - bottom)
        }
      }
      return value.get()
    }
    fun awaitCondition(message: String, condition: () -> Boolean) {
      val end = SystemClock.uptimeMillis() + 20_000
      while (SystemClock.uptimeMillis() < end) {
        if (condition()) return
        SystemClock.sleep(150)
      }
      fail(message)
    }
    fun currentDraft(): String? {
      val value = AtomicReference<String?>()
      instrumentation.runOnMainSync { value.set((activity.currentFocus as? EditText)?.text?.toString()) }
      return value.get()
    }
    fun screenshot(name: String) {
      val directory = context.getExternalFilesDir(null) ?: return
      try {
        val bitmap = automation.takeScreenshot() ?: return
        File(directory, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
      } catch (_: Exception) {
        // Geometry assertions remain authoritative when screenshot capture is unavailable.
      }
    }
    val density = context.resources.displayMetrics.density
    val touchTarget = (48 * density).toInt()
    val maxGap = (64 * density).toInt()
    val inputLabel = "Carrier message draft"
    val sendLabel = "Submit channel text to radio"
    fun awaitOpenGeometry(closedHistory: Rect, closedHeader: Rect) {
      awaitCondition("Docked IME must leave the full input, Send, header and shrunken history visible") {
        val top = imeTop() ?: return@awaitCondition false
        val root = appRoot()
        val input = find(root, inputLabel) ?: return@awaitCondition false
        val send = find(root, sendLabel) ?: return@awaitCondition false
        val history = find(root, "Chat message history") ?: return@awaitCondition false
        val header = find(root, "Back to chats") ?: return@awaitCondition false
        input.bottom <= top && send.bottom <= top &&
          input.height() >= touchTarget && send.height() >= touchTarget && send.width() >= touchTarget &&
          top - send.bottom <= maxGap && header.top == closedHeader.top &&
          history.height() > 0 && history.height() < closedHistory.height()
      }
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
      for ((slot, name) in listOf("Keyboard Alpha", "Keyboard Bravo").withIndex()) {
        val id = nativeCall { store.chatConfigurationId("synthetic-keyboard-fixture-" + slot, it) } as String
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
      tap("Open chat Keyboard Alpha")
      val closedHistory = await("Chat message history")
      val closedHeader = await("Back to chats")
      val closedSend = await(sendLabel)
      assertNull("Keyboard must start dismissed", imeTop())
      screenshot("keyboard-closed.png")
      tap(inputLabel)
      awaitOpenGeometry(closedHistory, closedHeader)
      instrumentation.sendStringSync("first line")
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_ENTER)
      instrumentation.sendStringSync("second line")
      awaitCondition("Multiline typing must remain in the focused draft") { currentDraft() == "first line\nsecond line" }
      awaitOpenGeometry(closedHistory, closedHeader)
      screenshot("keyboard-multiline.png")
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      awaitCondition("Back must dismiss the IME without closing the chat") {
        imeTop() == null && find(appRoot(), "Back to chats") != null &&
          (find(appRoot(), sendLabel)?.bottom ?: 0) >= closedSend.bottom - (8 * density).toInt()
      }
      tap("Back to chats")
      tap("Open chat Keyboard Bravo")
      tap(inputLabel)
      awaitOpenGeometry(closedHistory, closedHeader)
      awaitCondition("Other conversation must start with its own empty draft") { currentDraft() == "" }
      instrumentation.sendStringSync("bravo")
      awaitCondition("Bravo draft must be editable") { currentDraft() == "bravo" }
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      awaitCondition("Bravo IME dismissal") { imeTop() == null }
      tap("Back to chats")
      tap("Open chat Keyboard Alpha")
      repeat(2) {
        tap(inputLabel)
        awaitOpenGeometry(closedHistory, closedHeader)
        awaitCondition("Alpha multiline draft must survive room switch and IME reopen") { currentDraft() == "first line\nsecond line" }
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        awaitCondition("Repeated IME dismissal") { imeTop() == null && find(appRoot(), "Back to chats") != null }
      }
      tap(inputLabel)
      awaitOpenGeometry(closedHistory, closedHeader)
      tap("Quick messages")
      tap("Ready to go.")
      awaitCondition("Quick message must populate the draft") { currentDraft() == "Ready to go." }
      awaitOpenGeometry(closedHistory, closedHeader)
      screenshot("keyboard-quick-message.png")
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      awaitCondition("Final IME dismissal") { imeTop() == null }
    } finally {
      screenshot("keyboard-final.png")
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
