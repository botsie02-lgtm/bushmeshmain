package com.bushmeshmain.radio

import android.os.Build
import android.util.Log
import android.view.inputmethod.InputMethodManager
import android.content.Context
import android.widget.EditText
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowInsets
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule

/** Geometry for the visible Radio room, plus user-touch-only IME reopening.
 * Never consumes system insets or touches microphone/transport state. */
class BushMeshRadioImeModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {
  override fun getName() = "BushMeshRadioIme"

  private var watchedTag: Int? = null
  private var watchedSession: Int? = null
  private val diagnostic get() = context.packageName == "com.bushmeshmain.radioredesign"
  private fun trace(message: String) { if (diagnostic) Log.i("BushMeshRadioIme", message) }
  private var observer: ViewTreeObserver? = null
  private var listener: ViewTreeObserver.OnPreDrawListener? = null

  @ReactMethod
  fun watch(tag: Int, session: Int) {
    UiThreadUtil.runOnUiThread {
      clear()
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@runOnUiThread
      val activity = context.currentActivity ?: return@runOnUiThread
      val decor = activity.window.decorView
      watchedTag = tag
      watchedSession = session
      trace("watch tag=$tag session=$session activity=${System.identityHashCode(activity)}")
      var previous: String? = null
      val location = IntArray(2)
      val callback = ViewTreeObserver.OnPreDrawListener {
        if (watchedTag == tag && watchedSession == session && context.currentActivity === activity) {
          val room = activity.findViewById<View>(tag)
          val insets = decor.rootWindowInsets
          if (room != null && room.isAttachedToWindow && room.isShown && room.height > 0 && insets != null) {
            val ime = insets.getInsets(WindowInsets.Type.ime()).bottom
            val visible = insets.isVisible(WindowInsets.Type.ime()) && ime > 0
            room.getLocationOnScreen(location)
            val keyboardTop = activity.windowManager.currentWindowMetrics.bounds.bottom - ime
            // The actual room bottom already excludes any safe area, tabs,
            // and system-driven resize. Charge only the remaining overlap.
            val overlap = if (visible) {
              (location[1] + room.height - keyboardTop).coerceIn(0, room.height)
            } else 0
            val next = "tag=$tag session=$session view=${System.identityHashCode(room)} visible=$visible ime=$ime imeTop=$keyboardTop roomY=${location[1]} roomH=${room.height} overlapPx=$overlap nav=${insets.getInsets(WindowInsets.Type.navigationBars()).bottom}"
            if (next != previous) {
              previous = next
              trace(next)
              val event = Arguments.createMap().apply {
                putInt("tag", tag)
                putInt("session", session)
                putBoolean("visible", visible)
                putDouble("overlap", overlap / room.resources.displayMetrics.density.toDouble())
              }
              context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("BushMeshRadioImeGeometry", event)
            }
          }
        }
        true
      }
      observer = decor.viewTreeObserver
      listener = callback
      observer?.addOnPreDrawListener(callback)
      decor.invalidate()
    }
  }

  @ReactMethod
  fun unwatch(tag: Int, session: Int) {
    UiThreadUtil.runOnUiThread { if (watchedTag == tag && watchedSession == session) clear() }
  }

  /** Android Back can hide the IME without blurring ReactEditText. Only a
   * fresh user touch may request reopening; never reopen from an inset event. */
  @ReactMethod
  fun reopenFocusedInput(tag: Int, session: Int, inputTag: Int) {
    UiThreadUtil.runOnUiThread {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || watchedTag != tag || watchedSession != session) return@runOnUiThread
      val activity = context.currentActivity ?: return@runOnUiThread
      val room = activity.findViewById<View>(tag) ?: return@runOnUiThread
      val input = room.findViewById<View>(inputTag) as? EditText ?: return@runOnUiThread
      if (!room.isShown || !input.isAttachedToWindow || !input.isShown || !input.isFocused || !input.hasWindowFocus() || !input.isEnabled) return@runOnUiThread
      val insets = input.rootWindowInsets ?: return@runOnUiThread
      if (insets.isVisible(WindowInsets.Type.ime())) return@runOnUiThread
      val controller = input.windowInsetsController
      if (controller != null) {
        controller.show(WindowInsets.Type.ime())
        trace("touch reopen tag=$tag session=$session input=$inputTag via=insetsController")
      } else {
        val manager = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        val requested = manager.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        trace("touch reopen tag=$tag session=$session input=$inputTag via=imm requested=$requested")
      }
    }
  }

  @ReactMethod
  fun reportLayout(tag: Int, session: Int, visible: Boolean, padding: Double, height: Double) {
    if (!diagnostic) return
    UiThreadUtil.runOnUiThread {
      if (watchedTag == tag && watchedSession == session) trace("react tag=$tag session=$session visible=$visible paddingDp=$padding heightDp=$height")
    }
  }

  private fun clear() {
    val current = observer
    val callback = listener
    if (current != null && current.isAlive && callback != null) current.removeOnPreDrawListener(callback)
    if (watchedTag != null) trace("unwatch tag=$watchedTag session=$watchedSession")
    watchedTag = null
    watchedSession = null
    observer = null
    listener = null
  }

  override fun invalidate() {
    UiThreadUtil.runOnUiThread { clear() }
    super.invalidate()
  }
}
