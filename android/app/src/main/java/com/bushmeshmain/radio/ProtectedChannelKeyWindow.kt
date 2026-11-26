package com.bushmeshmain.radio

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/** Main-thread, activity-owned window. No secret in saved state, logs or exceptions. */
internal class ProtectedChannelKeyWindow {
  private val handler = Handler(Looper.getMainLooper())
  internal var dialog: AlertDialog? = null
    private set
  internal var keyView: TextView? = null
    private set

  fun hide() {
    dialog?.dismiss()
    dialog = null
    keyView = null
  }

  fun show(activity: Activity, secret: String, copy: () -> Unit) {
    check(Looper.myLooper() == Looper.getMainLooper())
    require(secret.matches(Regex("[0-9a-fA-F]{32}")))
    check(!activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus())
    hide()
    val density = activity.resources.displayMetrics.density
    val pad = (24 * density).toInt()
    val content = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(pad, pad, pad, pad)
      setBackgroundColor(Color.rgb(24, 30, 26))
    }
    val explanation = TextView(activity).apply {
      text = "Anyone possessing this shared channel key may access the channel. This is not an identity private key."
      setTextColor(Color.WHITE)
      textSize = 15f
    }
    val key = TextView(activity).apply {
      text = secret.chunked(8).joinToString("\n")
      setTextColor(Color.rgb(204, 255, 102))
      typeface = android.graphics.Typeface.MONOSPACE
      textSize = 24f
      setPadding(0, pad, 0, pad)
      isSaveEnabled = false
      importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO
    }
    content.addView(explanation)
    content.addView(key)
    val window = AlertDialog.Builder(activity, android.R.style.Theme_Material_Dialog_Alert)
      .setTitle("Shared channel key (PSK)")
      .setView(content)
      .setPositiveButton("Hide", null)
      .setNeutralButton("Copy key", null)
      .create()
    checkNotNull(window.window).addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    val timeout = Runnable { if (dialog === window) hide() }
    val lifecycle = object : Application.ActivityLifecycleCallbacks {
      override fun onActivityCreated(a: Activity, state: Bundle?) = Unit
      override fun onActivityStarted(a: Activity) = Unit
      override fun onActivityResumed(a: Activity) = Unit
      override fun onActivityPaused(a: Activity) { if (a === activity && dialog === window) hide() }
      override fun onActivityStopped(a: Activity) = Unit
      override fun onActivitySaveInstanceState(a: Activity, state: Bundle) = Unit
      override fun onActivityDestroyed(a: Activity) { if (a === activity && dialog === window) hide() }
    }
    window.setOnDismissListener {
      handler.removeCallbacks(timeout)
      activity.application.unregisterActivityLifecycleCallbacks(lifecycle)
      key.text = ""
      if (dialog === window) {dialog = null; keyView = null}
    }
    dialog = window
    keyView = key
    activity.application.registerActivityLifecycleCallbacks(lifecycle)
    try {
      window.show()
      window.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(Color.rgb(204, 255, 102))
      window.getButton(AlertDialog.BUTTON_NEUTRAL).apply {
        setTextColor(Color.rgb(204, 255, 102))
        setOnClickListener {
          try {
            copy()
            Toast.makeText(activity, "Key copied to sensitive clipboard.", Toast.LENGTH_SHORT).show()
          } catch (_: Exception) {
            Toast.makeText(activity, "Could not copy key.", Toast.LENGTH_SHORT).show()
          }
        }
      }
      handler.postDelayed(timeout, 30_000)
    } catch (error: Exception) {
      activity.application.unregisterActivityLifecycleCallbacks(lifecycle)
      key.text = ""
      hide()
      throw error
    }
  }
}
