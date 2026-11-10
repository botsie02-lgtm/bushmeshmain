package com.bushmesh.securityprobe

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject

/**
 * Pure native Activity: no ReactNative, no radio receivers, no background tasks.
 * Runs only after an explicit button press and writes only a sanitized report.
 */
class ProbeActivity : Activity() {
  private lateinit var message: TextView
  private lateinit var runButton: Button
  private lateinit var exportButton: Button
  private val exportRequest = 2451

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val scroll = ScrollView(this)
    val layout = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(28, 24, 28, 24)
    }
    val title = TextView(this).apply {
      text = "BushMesh security capability probe"
      textSize = 22f
    }
    val warning = TextView(this).apply {
      text = "Separate application: com.bushmesh.securityprobe\n" +
        "No radio, internet, location, convoy, or map permissions.\n" +
        "This is a hardware capability test, NOT production security activation."
      textSize = 16f
    }
    message = TextView(this).apply {
      text = "Press Run to test isolated Keystore capabilities. Unsupported operations will be reported, not replaced."
      textSize = 14f
      setTextIsSelectable(true)
    }
    runButton = Button(this).apply {
      text = "Run isolated capability test"
      setOnClickListener { runIsolatedProbe() }
    }
    exportButton = Button(this).apply {
      text = "Export report JSON (no secrets)"
      isEnabled = false
      setOnClickListener { exportReport() }
    }
    for (view in listOf(title, warning, runButton, exportButton, message)) {
      layout.addView(view, LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }
    scroll.addView(layout)
    setContentView(scroll)
  }

  private fun runIsolatedProbe() {
    runButton.isEnabled = false
    exportButton.isEnabled = false
    message.text = "Running local hardware self-tests; no external connections."
    Thread {
      val (rendered, freshReportSaved) = try {
        val report = ProbeReport.inspect(applicationContext)
        ProbeReport.save(applicationContext, report)
        Pair(report.toString(2), true)
      } catch (e: Exception) {
        val failure = JSONObject().put("schema", "bushmesh-security-probe-capabilities-v1")
          .put("classification", "PROBE_FAILED_CLOSED")
          .put("failureClass", e.javaClass.simpleName)
          .put("productionSecurityActivated", false)
          .put("secretsOrKeyBytesIncluded", false)
        val saved = try {
          ProbeReport.save(applicationContext, failure)
          true
        } catch (_: Exception) { false }
        Pair(failure.toString(2), saved)
      }
      runOnUiThread {
        message.text = rendered
        runButton.isEnabled = true
        // A failed new run cannot export an old, misleading PASS report.
        exportButton.isEnabled = freshReportSaved
      }
    }.start()
  }

  private fun exportReport() {
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "application/json"
      putExtra(Intent.EXTRA_TITLE, "bushmesh-security-capabilities.json")
    }
    startActivityForResult(intent, exportRequest)
  }

  @Deprecated("Used solely for the system document picker export flow")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != exportRequest || resultCode != RESULT_OK) return
    val uri = data?.data ?: return
    try {
      val bytes = ProbeReport.readExportable(applicationContext).toByteArray(Charsets.UTF_8)
      contentResolver.openOutputStream(uri, "w")?.use { it.write(bytes) }
        ?: throw IllegalStateException("Document picker did not open output")
      message.append("\n\nSanitized report exported with the system document picker.")
    } catch (e: Exception) {
      message.append("\n\nExport failed: " + e.javaClass.simpleName)
    }
  }
}
