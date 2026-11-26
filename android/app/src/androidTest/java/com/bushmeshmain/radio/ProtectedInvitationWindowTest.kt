package com.bushmeshmain.radio

import android.app.AlertDialog
import android.content.Intent
import android.os.SystemClock
import android.view.WindowManager
import androidx.test.platform.app.InstrumentationRegistry
import com.bushmeshmain.MainActivity
import org.junit.Assert.*
import org.junit.Test

class ProtectedInvitationWindowTest {
  @Test fun qrWindowIsSecureAndDismissesOnPause() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val activity = instrumentation.startActivitySync(Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    val owner = ProtectedInvitationWindow()
    val synthetic = "BUSHMESH-CHAT-1:eyJuYW1lIjoiVGVzdCIsInNlY3JldEhleCI6IjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExIn0="
    fun waitFor(condition: () -> Boolean) {
      val until = SystemClock.uptimeMillis() + 10_000
      while (SystemClock.uptimeMillis() < until) {
        var ready = false
        instrumentation.runOnMainSync { ready = condition() }
        if (ready) return
        SystemClock.sleep(100)
      }
      fail("Protected QR window condition not reached")
    }
    try {
      waitFor { activity.hasWindowFocus() }
      instrumentation.runOnMainSync { owner.showQr(activity, synthetic) }
      waitFor { owner.dialog?.window?.decorView?.hasWindowFocus() == true }
      instrumentation.runOnMainSync {
        assertTrue(owner.dialog!!.window!!.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        owner.dialog!!.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
      }
      waitFor { owner.dialog == null && activity.hasWindowFocus() }
      instrumentation.runOnMainSync { owner.showQr(activity, synthetic) }
      waitFor { owner.dialog?.window?.decorView?.hasWindowFocus() == true }
      instrumentation.runOnMainSync { activity.moveTaskToBack(true) }
      waitFor { owner.dialog == null }
    } finally {
      instrumentation.runOnMainSync { owner.hide(); activity.finish() }
    }
  }
}
