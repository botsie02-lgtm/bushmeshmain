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
    val constrained = InstrumentationRegistry.getArguments().getString("menuConstrained") == "true"
    val bravoDisplayName = "Smoke Bravo — remote Australian convoy recovery and campsite coordination"
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
      flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
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
    // The inbox and modal share the selected conversation's text. Only
    // the dedicated heading in a new, active and focused modal window
    // can satisfy the heading geometry assertions.
    var menuWindowId: Int? = null
    fun modalRoot(windowId: Int): AccessibilityNodeInfo? {
      val window = automation.windows.firstOrNull {
        it.id == windowId && it.type == AccessibilityWindowInfo.TYPE_APPLICATION && it.isActive && it.isFocused
      } ?: return null
      val root = window.root ?: return null
      if (root.packageName?.toString() != context.packageName || root.windowId != windowId) return null
      return root
    }
    fun dedicatedHeading(node: AccessibilityNodeInfo?, name: String): Rect? {
      if (node == null) return null
      val id = node.viewIdResourceName
      val exactIdentity = id == "conversation-options-heading" ||
        id?.endsWith(":id/conversation-options-heading") == true
      if ((exactIdentity || node.isHeading) && node.text?.toString() == name) {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (node.isVisibleToUser && !bounds.isEmpty) return bounds
      }
      for (i in 0 until node.childCount) dedicatedHeading(node.getChild(i), name)?.let { return it }
      return null
    }
    data class MenuGeometry(val windowId: Int, val heading: Rect, val firstAction: Rect)
    fun awaitMenuGeometry(inboxWindowId: Int, name: String): MenuGeometry {
      val deadline = SystemClock.uptimeMillis() + 20_000
      var previous: MenuGeometry? = null
      while (SystemClock.uptimeMillis() < deadline) {
        val active = automation.windows.firstOrNull {
          it.type == AccessibilityWindowInfo.TYPE_APPLICATION && it.isActive && it.isFocused && it.id != inboxWindowId
        }
        val root = active?.let { modalRoot(it.id) }
        val heading = dedicatedHeading(root, name)
        val action = find(root, "Pin chat")
        val backdrop = find(root, "Dismiss conversation options")
        val current = if (root != null && heading != null && action != null && backdrop != null)
          MenuGeometry(root.windowId, heading, action) else null
        if (current != null && current == previous) return current
        previous = current
        SystemClock.sleep(200)
      }
      error("Stable active modal heading and actions unavailable at $stage: $name")
    }
    fun awaitMenuAction(label: String): Rect {
      val windowId = checkNotNull(menuWindowId) { "No qualified menu window" }
      val deadline = SystemClock.uptimeMillis() + 20_000
      while (SystemClock.uptimeMillis() < deadline) {
        find(modalRoot(windowId), label)?.let { return it }
        SystemClock.sleep(200)
      }
      error("Modal action unavailable at $stage: $label (window=$windowId)")
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
        lines.add("  ".repeat(depth) + "class=${node.className} resourceId=${node.viewIdResourceName} heading=${node.isHeading} text=${JSONObject.quote(node.text?.toString() ?: "")} desc=${JSONObject.quote(node.contentDescription?.toString() ?: "")} visible=${node.isVisibleToUser} selected=${node.isSelected} focused=${node.isFocused} clickable=${node.isClickable} bounds=$bounds")
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
    fun checkpoint(name: String, screenshot: Boolean = false) {
      stage = name
      evidence(name, screenshot)
    }
    fun inbox() {
      menuWindowId = null
      await("Radio", true, tab = true)
      await("Conversation inbox")
      await("Chat options Smoke Alpha")
      await("Chat options Smoke Bravo")
    }
    fun scrollable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
      if (node == null) return null
      if (node.isVisibleToUser && node.isScrollable && node.className?.toString() == "android.widget.ScrollView") return node
      for (i in 0 until node.childCount) scrollable(node.getChild(i))?.let { return it }
      return null
    }
    fun awaitCloseAction(): Rect {
      val windowId = checkNotNull(menuWindowId)
      val deadline = SystemClock.uptimeMillis() + 20_000
      while (SystemClock.uptimeMillis() < deadline) {
        val root = modalRoot(windowId)
        val close = find(root, "Close chat options")
        // An accessibility node can be partially clipped. Require a
        // usable full 48dp target before the existing real-touch dismissal.
        if (close != null && close.height() >= (48 * context.resources.displayMetrics.density).toInt() - 1) return close
        scrollable(root)?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
        SystemClock.sleep(200)
      }
      error("Close chat options not reachable at $stage")
    }
    fun openOptions(name: String) {
      stage = "open-" + name.substringAfter(" ").lowercase()
      val row = await("Chat options $name")
      val inboxWindowId = checkNotNull(activeRoot()).windowId
      touch(row)
      val headingName = if (name == "Smoke Bravo") bravoDisplayName else name
      val geometry = awaitMenuGeometry(inboxWindowId, headingName)
      menuWindowId = geometry.windowId
      val heading = geometry.heading
      val first = geometry.firstAction
      assertTrue("Heading must have nonzero height above the action area: $heading / $first",
        heading.height() > 0 && heading.bottom <= first.top)
      awaitCloseAction()
      // Compare the same heading identity, in the same active modal,
      // after scroll reachability. Wait for two consecutive observations.
      val deadline = SystemClock.uptimeMillis() + 20_000
      var previous: Rect? = null
      var afterScroll: Rect? = null
      while (SystemClock.uptimeMillis() < deadline) {
        val bounds = dedicatedHeading(modalRoot(geometry.windowId), headingName)
        if (bounds != null && bounds == previous) { afterScroll = bounds; break }
        previous = bounds
        SystemClock.sleep(200)
      }
      assertEquals("Heading must stay visible and stationary while actions scroll", heading, afterScroll)
      trace("HEADING_VISIBLE name=${JSONObject.quote(headingName)} inboxWindow=$inboxWindowId modalWindow=${geometry.windowId} bounds=$heading firstAction=$first afterScroll=$afterScroll")
    }
    try {
      // Waiting for actual UI ensures the production React instance is running.
      await("Drive", true, tab = true)
      await("Radio", false, tab = true)
      checkpoint("drive-before-fixture")
      val fontScale = activity.resources.configuration.fontScale
      val viewport = activity.windowManager.currentWindowMetrics.bounds
      trace("MENU_VIEWPORT constrained=$constrained fontScale=$fontScale bounds=$viewport")
      if (constrained) {
        assertTrue("Constrained menu must actually use large fonts", fontScale >= 1.45f)
        assertTrue("Constrained menu must actually use a reduced viewport", viewport.height() <= 1500)
      }
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
        entries.put(id, JSONObject().put("displayName", if (slot == 1) bravoDisplayName else "").put("pinned", false).put("archived", false).put("unread", false)
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
      checkpoint("alpha-menu", screenshot = true)
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      inbox()
      checkpoint("back-dismissed")
      openOptions("Smoke Bravo")
      checkpoint("bravo-menu", screenshot = true)
      touch(awaitCloseAction())
      inbox()
      checkpoint("button-dismissed")
      // The second, compact-viewport qualification is deliberately focused
      // on heading geometry and scroll reachability. The normal run below
      // still covers every original dismissal and details interaction.
      if (constrained) return
      openOptions("Smoke Alpha")
      // Backdrop centre could be obscured by sheet, tap near its top instead.
      val backdrop = awaitMenuAction("Dismiss conversation options")
      touch(backdrop, (backdrop.top + 20).toFloat())
      inbox()
      checkpoint("backdrop-dismissed")
      openOptions("Smoke Bravo")
      touch(awaitMenuAction("Chat details"))
      await("Back")
      await("Smoke Bravo")
      checkpoint("bravo-details")
      tap("Back")
      inbox()
      checkpoint("details-returned")
      openOptions("Smoke Alpha")
      touch(awaitCloseAction())
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
