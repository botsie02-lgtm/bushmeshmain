package com.bushmeshmain.radio

import android.content.Intent
import android.graphics.Rect
import android.graphics.Bitmap
import android.accessibilityservice.AccessibilityServiceInfo
import android.util.Log
import android.view.View
import android.view.accessibility.AccessibilityWindowInfo
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
    automation.serviceInfo = automation.serviceInfo.apply {
      flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
    }
    val directory = checkNotNull(context.getExternalFilesDir(null))
    var stage = "startup"
    val expected = mutableListOf<String>()
    var fixture: String? = null
    fun trace(message: String) {
      val line = "stage=$stage $message"
      Log.i("BushMeshMenuTest", line)
      println(line)
      File(directory, "menu-stages.txt").appendText(line + "\n")
    }
    // Never tap a background app window or a hidden node behind a modal.
    fun activeRoot(): AccessibilityNodeInfo? {
      val root = automation.rootInActiveWindow
      if (root != null) return root.takeIf { it.packageName?.toString() == context.packageName }
      return automation.windows.firstOrNull { it.isActive && it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
        ?.root?.takeIf { it.packageName?.toString() == context.packageName }
    }
    fun find(node: AccessibilityNodeInfo?, label: String, selected: Boolean? = null, within: Rect? = null): Rect? {
      if (node == null) return null
      if ((node.contentDescription?.toString() == label || node.text?.toString() == label) &&
          (selected == null || node.isSelected == selected)) {
        val rect = Rect()
        node.getBoundsInScreen(rect)
        if (node.isVisibleToUser && !rect.isEmpty &&
            (within == null || within.contains(rect.centerX(), rect.centerY()))) return rect
      }
      for (i in 0 until node.childCount) find(node.getChild(i), label, selected, within)?.let { return it }
      return null
    }
    fun navigationBounds(): Rect? {
      val value = AtomicReference<Rect?>()
      instrumentation.runOnMainSync {
        val nav = activity.window.decorView.findViewWithTag<View>("radio-ime-bottom-navigation")
        val rect = Rect()
        if (nav != null && nav.isShown && nav.getGlobalVisibleRect(rect)) value.set(rect)
      }
      return value.get()
    }
    // Diagnostics are restricted to the isolated synthetic app. No raw
    // catalogue contents, credentials, or other apps' accessibility text.
    fun evidence(name: String, screenshot: Boolean = false) {
      val lines = mutableListOf<String>()
      val native = AtomicReference<String>()
      instrumentation.runOnMainSync {
        native.set("activityFocus=${activity.hasWindowFocus()} finishing=${activity.isFinishing} destroyed=${activity.isDestroyed} nativeFocus=${activity.currentFocus?.javaClass?.simpleName} nativeFocusTag=${activity.currentFocus?.tag}")
      }
      val roots = automation.windows
      lines.add("stage=$stage ${native.get()} expected=$expected")
      val root = activeRoot()
      lines.add("activeAppRoot=${root != null} radioSelected=${find(root, "Radio", true, navigationBounds()) != null} inbox=${find(root, "Conversation inbox") != null} settings=${find(root, "Back to Radio") != null} restoring=${find(root, "Restoring saved chats…") != null} restoreFailed=${find(root, "Saved chats unavailable") != null}")
      val disk = fixtureStore?.let { store -> runCatching { nativeCall { store.loadChatPreferences(it) } as? String }.getOrNull() }
      lines.add("catalogueFixtureExact=${fixture != null && disk == fixture} catalogueReadAvailable=${disk != null}")
      fun dump(node: AccessibilityNodeInfo?, depth: Int) {
        if (node == null || depth > 40 || lines.size > 3000) return
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        lines.add("  ".repeat(depth) + "class=${node.className} text=${JSONObject.quote(node.text?.toString() ?: "")} desc=${JSONObject.quote(node.contentDescription?.toString() ?: "")} visible=${node.isVisibleToUser} selected=${node.isSelected} focused=${node.isFocused} clickable=${node.isClickable} bounds=$bounds")
        for (i in 0 until node.childCount) dump(node.getChild(i), depth + 1)
      }
      for (window in roots) {
        val bounds = Rect()
        window.getBoundsInScreen(bounds)
        val windowRoot = window.root
        lines.add("window id=${window.id} type=${window.type} active=${window.isActive} focused=${window.isFocused} bounds=$bounds package=${windowRoot?.packageName}")
        if (windowRoot?.packageName?.toString() == context.packageName) dump(windowRoot, 0)
      }
      if (roots.isEmpty()) dump(root, 0)
      File(directory, "menu-$name.txt").writeText(lines.joinToString("\n"))
      trace(lines.take(3).joinToString(" | "))
      if (screenshot) {
        val bitmap = checkNotNull(automation.takeScreenshot()) { "Menu screenshot unavailable" }
        try {
          File(directory, "menu-$name.png").outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        } finally { bitmap.recycle() }
      }
    }
    fun await(label: String, selected: Boolean? = null, tab: Boolean = false): Rect {
      val deadline = SystemClock.uptimeMillis() + 20_000
      while (SystemClock.uptimeMillis() < deadline) {
        val bounds = if (tab) navigationBounds() else null
        if (!tab || bounds != null) {
          find(activeRoot(), label, selected, bounds)?.let { return it }
        }
        SystemClock.sleep(200)
      }
      error("UI action unavailable at $stage: $label")
    }
    fun touch(r: Rect, y: Float = r.exactCenterY()) {
      val now = SystemClock.uptimeMillis()
      for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
        val event = MotionEvent.obtain(now, SystemClock.uptimeMillis(), action, r.exactCenterX(), y, 0)
        instrumentation.sendPointerSync(event)
        event.recycle()
      }
      instrumentation.waitForIdleSync()
    }
    fun tap(label: String) = touch(await(label))
    fun checkpoint(name: String) {
      stage = name
      evidence(name)
    }
    fun inbox() {
      await("Radio", true, tab = true)
      await("Conversation inbox")
      await("Chat options Smoke Alpha")
      await("Chat options Smoke Bravo")
    }
    fun openOptions(name: String) {
      stage = "open-" + name.substringAfter(" ").lowercase()
      tap("Chat options $name")
      await("Close chat options")
      await(name)
    }
    try {
      // Waiting for actual UI ensures the production React instance is running.
      await("Drive", true, tab = true)
      await("Radio", false, tab = true)
      checkpoint("drive-before-fixture")
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
        expected.add("$name slot=$slot id=$id")
        val config = JSONObject().put("id", id).put("radio", "synthetic-offline-radio").put("slot", slot).put("name", name).put("privateChannel", true)
        entries.put(id, JSONObject().put("displayName", "").put("pinned", false).put("archived", false).put("unread", false)
          .put("localCreator", false).put("origin", "unknown").put("description", "").put("avatarColor", "lime").put("avatarIcon", "initials")
          .put("configuration", config).put("incarnation", 1).put("retired", false))
      }
      val serialized = JSONObject().put("version", 2).put("entries", entries).put("sort", "recent").toString()
      fixture = serialized
      assertTrue(nativeCall { store.saveChatPreferences(serialized, it) } == true)
      fixtureSaved = true
      assertTrue("Encrypted catalogue readback mismatch", nativeCall { store.loadChatPreferences(it) } == serialized)
      checkpoint("fixture-written")
      stage = "radio-selection"
      touch(await("Radio", false, tab = true))
      await("Radio", true, tab = true)
      checkpoint("radio-selected")
      stage = "catalogue-hydration"
      inbox()
      checkpoint("catalogue-ready")
      openOptions("Smoke Alpha")
      checkpoint("alpha-menu")
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      inbox()
      checkpoint("back-dismissed")
      openOptions("Smoke Bravo")
      checkpoint("bravo-menu")
      tap("Close chat options")
      inbox()
      checkpoint("button-dismissed")
      openOptions("Smoke Alpha")
      // Backdrop centre could be obscured by sheet, tap near its top instead.
      val backdrop = await("Dismiss conversation options")
      touch(backdrop, (backdrop.top + 20).toFloat())
      inbox()
      checkpoint("backdrop-dismissed")
      openOptions("Smoke Bravo")
      tap("Chat details")
      await("Back")
      await("Smoke Bravo")
      checkpoint("bravo-details")
      tap("Back")
      inbox()
      checkpoint("details-returned")
      openOptions("Smoke Alpha")
      tap("Close chat options")
      inbox()
      checkpoint("complete")
    } catch (failure: Throwable) {
      // Capture before finishing the activity; evidence failure must not mask
      // the original assertion or prevent encrypted restoration.
      runCatching { evidence("failure", screenshot = true) }.onFailure { Log.e("BushMeshMenuTest", "Failure evidence incomplete", it) }
      throw failure
    } finally {
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
