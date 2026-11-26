package com.bushmeshmain.radio

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.os.Bundle
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import com.google.zxing.BarcodeFormat
import com.google.zxing.ResultPoint
import com.google.zxing.qrcode.QRCodeWriter
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory

/** Activity-owned protected dialogs. No files, external camera intents or network. */
internal class ProtectedInvitationWindow {
  private val handler = Handler(Looper.getMainLooper())
  internal var dialog: AlertDialog? = null
    private set

  private fun dismissOnPause(activity: Activity, window: AlertDialog): Application.ActivityLifecycleCallbacks {
    val callbacks = object : Application.ActivityLifecycleCallbacks {
      override fun onActivityCreated(a: Activity, state: Bundle?) = Unit
      override fun onActivityStarted(a: Activity) = Unit
      override fun onActivityResumed(a: Activity) = Unit
      override fun onActivityPaused(a: Activity) { if (a === activity && dialog === window) hide() }
      override fun onActivityStopped(a: Activity) = Unit
      override fun onActivitySaveInstanceState(a: Activity, state: Bundle) = Unit
      override fun onActivityDestroyed(a: Activity) { if (a === activity && dialog === window) hide() }
    }
    activity.application.registerActivityLifecycleCallbacks(callbacks)
    return callbacks
  }

  fun hide() {
    dialog?.dismiss()
    dialog = null
  }

  fun showQr(activity: Activity, invitation: String) {
    check(!activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus())
    require(invitation.startsWith("BUSHMESH-CHAT-1:") && invitation.length <= 512)
    hide()
    val matrix = QRCodeWriter().encode(invitation, BarcodeFormat.QR_CODE, 768, 768)
    val pixels = IntArray(matrix.width * matrix.height) { i ->
      if (matrix.get(i % matrix.width, i / matrix.width)) Color.BLACK else Color.WHITE
    }
    val bitmap = Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888)
    bitmap.setPixels(pixels, 0, matrix.width, 0, 0, matrix.width, matrix.height)
    pixels.fill(0)
    matrix.clear()
    val image = ImageView(activity).apply {
      setImageBitmap(bitmap)
      adjustViewBounds = true
      contentDescription = "Private channel invitation QR"
      isSaveEnabled = false
      scaleType = ImageView.ScaleType.FIT_CENTER
    }
    val window = AlertDialog.Builder(activity)
      .setTitle("Private invitation QR")
      .setMessage("Anyone scanning this code can access the shared channel. Show only to trusted people. Not authenticated convoy membership.")
      .setView(image).setPositiveButton("Hide", null).create()
    val timeout = Runnable { if (dialog === window) hide() }
    val lifecycle = dismissOnPause(activity, window)
    window.setOnDismissListener {
      handler.removeCallbacks(timeout)
      activity.application.unregisterActivityLifecycleCallbacks(lifecycle)
      image.setImageDrawable(null)
      bitmap.eraseColor(Color.BLACK)
      if (dialog === window) dialog = null
    }
    dialog = window
    checkNotNull(window.window).addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    window.show()
    handler.postDelayed(timeout, 30_000)
  }

  fun scan(activity: Activity, complete: (String?) -> Unit) {
    check(!activity.isFinishing && !activity.isDestroyed)
    check(activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    hide()
    val scanner = DecoratedBarcodeView(activity).apply {
      barcodeView.decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
      setStatusText("Point at a private BushMesh invitation")
      isSaveEnabled = false
    }
    val frame = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      addView(scanner, LinearLayout.LayoutParams(-1, (360 * activity.resources.displayMetrics.density).toInt()))
    }
    val window = AlertDialog.Builder(activity)
      .setTitle("Scan private invitation")
      .setView(frame)
      .setNegativeButton("Cancel", null)
      .setNeutralButton("Torch", null)
      .create()
    var value: String? = null
    var torch = false
    val timeout = Runnable { if (dialog === window) hide() }
    val lifecycle = dismissOnPause(activity, window)
    window.setOnDismissListener {
      handler.removeCallbacks(timeout)
      activity.application.unregisterActivityLifecycleCallbacks(lifecycle)
      scanner.pause()
      if (dialog === window) dialog = null
      val result = value
      value = null
      complete(result)
    }
    dialog = window
    checkNotNull(window.window).addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    window.show()
    window.getButton(AlertDialog.BUTTON_NEUTRAL).apply {
      isEnabled = activity.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH)
      setOnClickListener {
        torch = !torch
        if (torch) scanner.setTorchOn() else scanner.setTorchOff()
        text = if (torch) "Torch off" else "Torch on"
      }
    }
    scanner.decodeSingle(object : BarcodeCallback {
      override fun barcodeResult(result: BarcodeResult) {
        if (dialog !== window) return
        value = result.text.takeIf { it.length <= 512 } ?: ""
        hide()
      }
      override fun possibleResultPoints(resultPoints: MutableList<ResultPoint>?) = Unit
    })
    scanner.resume()
    handler.postDelayed(timeout, 120_000)
  }
}
