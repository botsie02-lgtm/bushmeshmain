package com.bushmeshmain.radio

import android.os.Build
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowInsets
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule

/** Read-only geometry for the visible Radio room. Never consumes system insets,
 * changes the activity window, or touches microphone/transport state. */
class BushMeshRadioImeModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {
  override fun getName() = "BushMeshRadioIme"

  private var watchedTag: Int? = null
  private var observer: ViewTreeObserver? = null
  private var listener: ViewTreeObserver.OnPreDrawListener? = null

  @ReactMethod
  fun watch(tag: Int) {
    UiThreadUtil.runOnUiThread {
      clear()
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@runOnUiThread
      val activity = context.currentActivity ?: return@runOnUiThread
      val decor = activity.window.decorView
      watchedTag = tag
      var previous: Pair<Boolean, Int>? = null
      val location = IntArray(2)
      val callback = ViewTreeObserver.OnPreDrawListener {
        if (watchedTag == tag && context.currentActivity === activity) {
          val room = activity.findViewById<View>(tag)
          val insets = decor.rootWindowInsets
          if (room != null && room.isShown && room.height > 0 && insets != null) {
            val ime = insets.getInsets(WindowInsets.Type.ime()).bottom
            val visible = insets.isVisible(WindowInsets.Type.ime()) && ime > 0
            room.getLocationOnScreen(location)
            val keyboardTop = activity.windowManager.currentWindowMetrics.bounds.bottom - ime
            // The actual room bottom already excludes any safe area, tabs,
            // and system-driven resize. Charge only the remaining overlap.
            val overlap = if (visible) {
              (location[1] + room.height - keyboardTop).coerceIn(0, room.height)
            } else 0
            val next = visible to overlap
            if (next != previous) {
              previous = next
              val event = Arguments.createMap().apply {
                putInt("tag", tag)
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
  fun unwatch(tag: Int) {
    UiThreadUtil.runOnUiThread { if (watchedTag == tag) clear() }
  }

  private fun clear() {
    val current = observer
    val callback = listener
    if (current != null && current.isAlive && callback != null) current.removeOnPreDrawListener(callback)
    watchedTag = null
    observer = null
    listener = null
  }

  override fun invalidate() {
    UiThreadUtil.runOnUiThread { clear() }
    super.invalidate()
  }
}
