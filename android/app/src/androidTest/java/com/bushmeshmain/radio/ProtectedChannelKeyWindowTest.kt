package com.bushmeshmain.radio

import android.app.AlertDialog
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import androidx.test.platform.app.InstrumentationRegistry
import com.bushmeshmain.MainActivity
import org.junit.Assert.*
import org.junit.Test

class ProtectedChannelKeyWindowTest {
  @Test fun secureWindowFocusCopyHideBackAndActivityPause() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val owner = ProtectedChannelKeyWindow()
    val synthetic = "ab".repeat(16)
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    fun waitFor(check: () -> Boolean) {
      val until = SystemClock.uptimeMillis() + 10_000
      while (SystemClock.uptimeMillis() < until) {
        var ready = false
        instrumentation.runOnMainSync { ready = check() }
        if (ready) return
        SystemClock.sleep(100)
      }
      fail("Protected window condition not reached")
    }
    fun show() {
      waitFor { activity.hasWindowFocus() }
      instrumentation.runOnMainSync { owner.show(activity, synthetic) { ProtectedChannelClipboard.copy(activity, synthetic) } }
      waitFor { owner.dialog?.window?.decorView?.hasWindowFocus() == true }
      instrumentation.runOnMainSync {
        assertTrue(owner.dialog!!.window!!.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        assertTrue(owner.keyView!!.isShown)
        assertTrue(owner.keyView!!.text.toString().replace("\n", "") == synthetic)
      }
    }
    fun tap(view: View) {
      val position = IntArray(2)
      instrumentation.runOnMainSync { view.getLocationOnScreen(position); position[0] += view.width / 2; position[1] += view.height / 2 }
      val now = SystemClock.uptimeMillis()
      for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
        val event = MotionEvent.obtain(now, SystemClock.uptimeMillis(), action, position[0].toFloat(), position[1].toFloat(), 0)
        instrumentation.sendPointerSync(event)
        event.recycle()
      }
      instrumentation.waitForIdleSync()
    }
    try {
      show()
      tap(owner.dialog!!.getButton(AlertDialog.BUTTON_NEUTRAL))
      waitFor { clipboard.primaryClipDescription?.extras?.getBoolean(ClipDescription.EXTRA_IS_SENSITIVE) == true }
      instrumentation.runOnMainSync { assertTrue(clipboard.primaryClip?.getItemAt(0)?.text?.toString() == synthetic) }
      tap(owner.dialog!!.getButton(AlertDialog.BUTTON_POSITIVE))
      waitFor { owner.dialog == null && owner.keyView == null }
      show()
      instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
      waitFor { owner.dialog == null }
      show()
      instrumentation.runOnMainSync { activity.moveTaskToBack(true) }
      waitFor { owner.dialog == null }
    } finally {
      instrumentation.runOnMainSync { owner.hide(); clipboard.clearPrimaryClip(); activity.finish() }
    }
  }
}
