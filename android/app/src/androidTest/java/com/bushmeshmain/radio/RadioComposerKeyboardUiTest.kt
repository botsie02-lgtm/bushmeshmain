package com.bushmeshmain.radio

import android.content.Intent
import android.graphics.Rect
import android.graphics.Bitmap
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.WindowInsets
import android.view.View
import android.view.accessibility.AccessibilityWindowInfo
import android.util.Log
import android.widget.EditText
import java.io.File
import android.os.SystemClock
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.text.InputType
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
    var phase = "startup"
    fun trace(message: String) {
      val line = "phase=$phase $message"
      Log.i("BushMeshKeyboardTest", line)
      println(line)
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
      trace("TIMEOUT $message")
      fail("$phase: $message")
    }
    data class DraftState(
      val text: String?, val focused: Boolean, val focusClass: String?,
      val focusTag: String?, val selectionStart: Int?, val selectionEnd: Int?,
      val inputType: Int?, val sentenceCaps: Boolean
    ) {
      fun evidence(): String =
        "observed=${text?.let { JSONObject.quote(it) } ?: "null"} " +
          "focused=$focused focusClass=$focusClass focusTag=$focusTag " +
          "selection=$selectionStart:$selectionEnd inputType=$inputType sentenceCaps=$sentenceCaps"
    }
    fun draftState(): DraftState {
      val value = AtomicReference<DraftState>()
      instrumentation.runOnMainSync {
        val input = activity.window.decorView.findViewWithTag<EditText>("radio-ime-input")
        val focus = activity.currentFocus
        value.set(DraftState(input?.text?.toString(), input != null && focus === input && input.isFocused,
          focus?.javaClass?.name, focus?.tag?.toString(), input?.selectionStart, input?.selectionEnd,
          input?.inputType, ((input?.inputType ?: 0) and InputType.TYPE_TEXT_FLAG_CAP_SENTENCES) != 0))
      }
      return checkNotNull(value.get())
    }
    fun awaitDraft(message: String, expected: String) {
      try {
        awaitCondition(message) {
          val observed = draftState()
          observed.focused && observed.text == expected
        }
      } catch (error: AssertionError) {
        val evidence = "expected=${JSONObject.quote(expected)} ${draftState().evidence()}"
        trace("DRAFT_MISMATCH $evidence")
        throw AssertionError("$phase: $message; $evidence", error)
      }
      trace("DRAFT_EXACT expected=${JSONObject.quote(expected)} ${draftState().evidence()}")
    }
    // Use the real focused RN editor's InputConnection instead of synthetic
    // printable key events, which can invoke Android/IME capitalisation.
    // No inputType, keyboard preference, JS draft, or production prop changes.
    // The editor's normal text watchers still deliver changes to React.
    fun commitLiteral(text: String) {
      instrumentation.runOnMainSync {
        val input = checkNotNull(activity.window.decorView.findViewWithTag<EditText>("radio-ime-input"))
        check(activity.currentFocus === input && input.isFocused) { "Literal input requires the focused composer" }
        val connection = checkNotNull(input.onCreateInputConnection(EditorInfo())) { "No composer input connection" }
        check(connection.commitText(text, 1)) { "Composer refused literal text commit" }
      }
      instrumentation.waitForIdleSync()
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
    data class Bounds(val full: Rect, val visible: Rect, val shown: Boolean, val focused: Boolean, val identity: Int, val tag: Int)
    data class NativeGeometry(
      val imeVisible: Boolean, val imeTop: Int?, val navInset: Int,
      val room: Bounds?, val layout: Bounds?, val input: Bounds?, val send: Bounds?,
      val header: Bounds?, val history: Bounds?, val navigation: Bounds?
    )
    fun nativeGeometry(): NativeGeometry {
      val value = AtomicReference<NativeGeometry>()
      instrumentation.runOnMainSync {
        val decor = activity.window.decorView
        val insets = decor.rootWindowInsets
        val bottom = insets?.getInsets(WindowInsets.Type.ime())?.bottom ?: 0
        val visible = insets?.isVisible(WindowInsets.Type.ime()) == true && bottom > 0
        fun bounds(name: String): Bounds? {
          val v = decor.findViewWithTag<View>(name) ?: return null
          val xy = IntArray(2)
          v.getLocationOnScreen(xy)
          val full = Rect(xy[0], xy[1], xy[0] + v.width, xy[1] + v.height)
          val clipped = Rect()
          v.getGlobalVisibleRect(clipped)
          return Bounds(full, clipped, v.isShown, v.isFocused, System.identityHashCode(v), v.id)
        }
        value.set(NativeGeometry(visible,
          if (visible) activity.windowManager.currentWindowMetrics.bounds.bottom - bottom else null,
          insets?.getInsets(WindowInsets.Type.navigationBars())?.bottom ?: 0,
          bounds("radio-ime-room"), bounds("radio-ime-layout"), bounds("radio-ime-input"),
          bounds("radio-ime-send"), bounds("radio-ime-header"), bounds("radio-ime-history"),
          bounds("radio-ime-bottom-navigation")))
      }
      return checkNotNull(value.get())
    }
    fun imeWindows(): List<Rect> = automation.windows.filter { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }
      .map { Rect().apply { it.getBoundsInScreen(this) } }
    fun awaitOpenGeometry(closedHistory: Rect, closedHeader: Rect) {
      var previous: String? = null
      var consecutive = 0
      awaitCondition("Docked IME must leave the full input, Send, header and shrunken history visible") {
        val native = nativeGeometry()
        val top = native.imeTop
        val root = appRoot()
        val input = find(root, inputLabel)
        val send = find(root, sendLabel)
        val history = find(root, "Chat message history")
        val header = find(root, "Back to chats")
        val windows = imeWindows()
        val failures = mutableListOf<String>()
        if (!native.imeVisible || top == null) failures.add("IME_NOT_VISIBLE")
        if (input == null || send == null || history == null || header == null) failures.add("ACCESSIBILITY_NODE_MISSING")
        if (top != null && input != null && input.bottom > top) failures.add("INPUT_BELOW_IME")
        if (top != null && send != null && send.bottom > top) failures.add("SEND_BELOW_IME")
        if (input != null && input.height() < touchTarget) failures.add("INPUT_TOUCH_HEIGHT")
        if (send != null && (send.height() < touchTarget || send.width() < touchTarget)) failures.add("SEND_TOUCH_SIZE")
        if (top != null && send != null && top - send.bottom > maxGap) failures.add("SEND_GAP")
        if (header != null && header.top != closedHeader.top) failures.add("HEADER_MOVED")
        if (history != null && (history.height() <= 0 || history.height() >= closedHistory.height())) failures.add("HISTORY_NOT_SHRUNK")
        // Accessibility bounds can be clipped. The underlying input and Send
        // must independently fit in their entirety, not just their visible slice.
        val fullInput = native.input
        val fullSend = native.send
        if (fullInput == null || fullSend == null) failures.add("NATIVE_COMPOSER_MISSING")
        if (top != null && fullInput != null && (!fullInput.shown || fullInput.full.bottom > top ||
            fullInput.full.height() < touchTarget || fullInput.visible.height() != fullInput.full.height() ||
            fullInput.visible.width() != fullInput.full.width())) failures.add("NATIVE_INPUT_CLIPPED")
        if (top != null && fullSend != null && (!fullSend.shown || fullSend.full.bottom > top ||
            fullSend.full.height() < touchTarget || fullSend.full.width() < touchTarget ||
            fullSend.visible.height() != fullSend.full.height() || fullSend.visible.width() != fullSend.full.width() ||
            top - fullSend.full.bottom > maxGap)) failures.add("NATIVE_SEND_CLIPPED_OR_GAP")
        if (native.navigation?.shown == true) failures.add("BOTTOM_NAVIGATION_VISIBLE")
        val snapshot = "failures=$failures imeWindows=$windows input=$input send=$send header=$header history=$history closedHeader=$closedHeader closedHistory=$closedHistory native=$native"
        if (snapshot != previous) { trace(snapshot); previous = snapshot; consecutive = 0 }
        consecutive = if (failures.isEmpty()) consecutive + 1 else 0
        consecutive >= 2
      }
      trace("OPEN_GEOMETRY_PASSED")
    }
    fun awaitClosedGeometry(closedSend: Rect) {
      var previous: String? = null
      var consecutive = 0
      awaitCondition("Back must fully dismiss IME and restore conversation geometry before another touch") {
        val native = nativeGeometry()
        val root = appRoot()
        val send = find(root, sendLabel)
        val input = find(root, inputLabel)
        val header = find(root, "Back to chats")
        val windows = imeWindows()
        val fullInput = native.input
        val fullSend = native.send
        val restored = !native.imeVisible && windows.none { !it.isEmpty } &&
          header != null && native.navigation?.shown == true &&
          send != null && input != null && fullInput != null && fullSend != null &&
          send.bottom >= closedSend.bottom - (8 * density).toInt() &&
          fullSend.full.bottom == send.bottom && fullInput.full.bottom == input.bottom
        val snapshot = "restored=$restored imeWindows=$windows input=$input send=$send header=$header native=$native"
        if (snapshot != previous) { trace(snapshot); previous = snapshot; consecutive = 0 }
        consecutive = if (restored) consecutive + 1 else 0
        consecutive >= 2
      }
      trace("CLOSED_GEOMETRY_PASSED")
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
      phase = "alpha-initial-closed"
      val closedSend = await(sendLabel)
      assertNull("Keyboard must start dismissed", imeTop())
      awaitClosedGeometry(closedSend)
      val closedHistory = await("Chat message history")
      val closedHeader = await("Back to chats")
      screenshot("keyboard-closed.png")
      phase = "alpha-initial-open"
      tap(inputLabel)
      awaitOpenGeometry(closedHistory, closedHeader)
      val alphaDraft = "first line\nsecond line"
      val bravoDraft = "bravo"
      // Start the deterministic path directly. Printable synthetic key
      // events can arrive after an apparent clear and contaminate the draft.
      phase = "alpha-multiline"
      awaitDraft("Alpha must start empty and focused", "")
      awaitOpenGeometry(closedHistory, closedHeader)
      commitLiteral("first line")
      awaitDraft("First literal line must remain exact", "first line")
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_ENTER)
      awaitDraft("Real Enter must insert a newline in the focused draft", "first line\n")
      commitLiteral("second line")
      awaitDraft("Multiline typing must remain in the focused draft", alphaDraft)
      // Exercise a real deletion and literal reinsertion, not a full-draft
      // overwrite that could conceal a broken newline or editing path.
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DEL)
      awaitDraft("Backspace must edit the final character only", alphaDraft.dropLast(1))
      commitLiteral("e")
      awaitDraft("Edited multiline draft must be exactly restored", alphaDraft)
      awaitOpenGeometry(closedHistory, closedHeader)
      screenshot("keyboard-multiline.png")
      phase = "alpha-first-close"
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      awaitClosedGeometry(closedSend)
      tap("Back to chats")
      tap("Open chat Keyboard Bravo")
      phase = "bravo-closed"
      val bravoSend = await(sendLabel)
      awaitClosedGeometry(bravoSend)
      val bravoHistory = await("Chat message history")
      val bravoHeader = await("Back to chats")
      phase = "bravo-open"
      tap(inputLabel)
      awaitOpenGeometry(bravoHistory, bravoHeader)
      awaitDraft("Other conversation must start with its own empty draft", "")
      commitLiteral(bravoDraft)
      awaitDraft("Bravo draft must be editable", bravoDraft)
      phase = "bravo-close"
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      awaitClosedGeometry(bravoSend)
      tap("Back to chats")
      tap("Open chat Keyboard Alpha")
      phase = "alpha-return-closed"
      val returnSend = await(sendLabel)
      awaitClosedGeometry(returnSend)
      val returnHistory = await("Chat message history")
      val returnHeader = await("Back to chats")
      repeat(2) { round ->
        phase = "alpha-reopen-${round + 1}"
        tap(inputLabel)
        awaitOpenGeometry(returnHistory, returnHeader)
        awaitDraft("Alpha multiline draft must survive room switch and IME reopen", alphaDraft)
        screenshot("keyboard-reopen-${round + 1}.png")
        phase = "alpha-reclose-${round + 1}"
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        awaitClosedGeometry(returnSend)
      }
      phase = "alpha-reopen-3"
      tap(inputLabel)
      awaitOpenGeometry(returnHistory, returnHeader)
      awaitDraft("Alpha multiline draft must survive the third IME reopen", alphaDraft)
      screenshot("keyboard-reopen-3.png")
      phase = "alpha-quick-message"
      tap("Quick messages")
      tap("Ready to go.")
      awaitDraft("Quick message must populate the draft", "Ready to go.")
      awaitOpenGeometry(returnHistory, returnHeader)
      screenshot("keyboard-quick-message.png")
      phase = "alpha-final-close"
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      awaitClosedGeometry(returnSend)
    } finally {
      runCatching { trace("FINAL native=${nativeGeometry()} imeWindows=${imeWindows()} ${draftState().evidence()}") }
      screenshot("keyboard-final.png")
      instrumentation.runOnMainSync { activity.finish() }
      instrumentation.waitForIdleSync()
      // Restore only if the fixture actually wrote to the isolated store.
      if (fixtureSaved) {
        val store = checkNotNull(fixtureStore)
        val restored = original ?: "{\"version\":2,\"entries\":{},\"sort\":\"recent\"}"
        assertTrue("Protected catalogue restoration failed", nativeCall { store.saveChatPreferences(restored, it) } == true)
        assertEquals("Protected catalogue restoration readback mismatch", restored, nativeCall { store.loadChatPreferences(it) })
        trace("FIXTURE_RESTORED_EXACT")
      }
    }
  }
}
