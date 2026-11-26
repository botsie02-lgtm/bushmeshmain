package com.bushmeshmain.radio

import android.content.ContentValues
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.nio.charset.StandardCharsets

class BushMeshExportModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val GPX_MIME = "application/gpx+xml"
    private const val JSON_MIME = "application/json"
  }

  override fun getName(): String = "BushMeshExport"

  @ReactMethod
  fun saveGpx(displayName: String, content: String, promise: Promise) {
    saveTextExport(
      displayName = displayName,
      content = content,
      extension = ".gpx",
      mimeType = GPX_MIME,
      fallbackName = "Bushmesh_Track.gpx",
      errorCode = "BUSHMESH_GPX_EXPORT_FAILED",
      promise = promise,
    )
  }

  @ReactMethod
  fun saveJson(displayName: String, content: String, promise: Promise) {
    saveTextExport(
      displayName = displayName,
      content = content,
      extension = ".json",
      mimeType = JSON_MIME,
      fallbackName = "Bushmesh_Field_Report.json",
      errorCode = "BUSHMESH_JSON_EXPORT_FAILED",
      promise = promise,
    )
  }

  @ReactMethod
  fun saveConversationExport(content: String, format: String, promise: Promise) {
    if (format != "txt" && format != "json") {
      promise.reject("BUSHMESH_CHAT_EXPORT_FAILED", "Unsupported format.")
      return
    }
    // A deliberately saved user document, not a temporary plaintext cache.
    saveTextExport("BushMesh_Chat_" + java.util.UUID.randomUUID().toString(),
      content, "." + format, if (format == "json") JSON_MIME else "text/plain",
      "BushMesh_Chat." + format, "BUSHMESH_CHAT_EXPORT_FAILED", promise)
  }

  @ReactMethod
  fun shareConversationExport(uriString: String, format: String, promise: Promise) {
    try {
      require(format == "txt" || format == "json")
      val uri = Uri.parse(uriString)
      require(uri.scheme == "content" && uri.authority == "media")
      val resolver = reactContext.contentResolver
      val columns = arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.OWNER_PACKAGE_NAME)
      val owned = resolver.query(uri, columns, null, null, null)?.use { cursor ->
        cursor.moveToFirst() && cursor.getString(0).startsWith("BushMesh_Chat_") &&
          cursor.getString(0).endsWith("." + format) && cursor.getString(1) == reactContext.packageName
      } ?: false
      check(owned)
      val activity = checkNotNull(reactContext.currentActivity)
      val intent = Intent(Intent.ACTION_SEND).apply {
        type = if (format == "json") JSON_MIME else "text/plain"
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newRawUri("BushMesh conversation export", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.runOnUiThread {
        try { activity.startActivity(Intent.createChooser(intent, "Share plaintext conversation")); promise.resolve(true) }
        catch (_: Exception) { promise.reject("BUSHMESH_CHAT_SHARE_FAILED", "Could not share the saved document.") }
      }
    } catch (_: Exception) {
      promise.reject("BUSHMESH_CHAT_SHARE_FAILED", "Could not share the saved document.")
    }
  }

  private fun saveTextExport(
    displayName: String,
    content: String,
    extension: String,
    mimeType: String,
    fallbackName: String,
    errorCode: String,
    promise: Promise,
  ) {
    try {
      val safeName = sanitizeFilename(displayName, extension, fallbackName)
      val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        saveViaMediaStore(safeName, content, mimeType)
      } else {
        saveToAppExternalDocuments(safeName, content)
      }

      val response = Arguments.createMap().apply {
        putString("displayName", safeName)
        putString("uri", result.first.toString())
        putString("location", result.second)
      }
      promise.resolve(response)
    } catch (error: Exception) {
      promise.reject(errorCode, error.message, error)
    }
  }

  private fun saveViaMediaStore(
    displayName: String,
    content: String,
    mimeType: String,
  ): Pair<Uri, String> {
    val resolver = reactContext.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
      put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
      put(
        MediaStore.MediaColumns.RELATIVE_PATH,
        Environment.DIRECTORY_DOWNLOADS + "/Bushmesh",
      )
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }

    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("Android could not create the Bushmesh export file.")

    try {
      resolver.openOutputStream(uri, "w")?.use { stream ->
        stream.write(content.toByteArray(StandardCharsets.UTF_8))
        stream.flush()
      } ?: throw IllegalStateException("Android could not open the Bushmesh export file.")

      val published = ContentValues().apply {
        put(MediaStore.MediaColumns.IS_PENDING, 0)
      }
      check(resolver.update(uri, published, null, null) > 0) { "Android did not publish the export." }
      return Pair(uri, "Downloads/Bushmesh")
    } catch (error: Exception) {
      resolver.delete(uri, null, null)
      throw error
    }
  }

  private fun saveToAppExternalDocuments(
    displayName: String,
    content: String,
  ): Pair<Uri, String> {
    val root = reactContext.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
      ?: throw IllegalStateException("Android external documents storage is unavailable.")
    val folder = File(root, "Bushmesh").apply { mkdirs() }
    val file = File(folder, displayName)
    file.writeText(content, Charsets.UTF_8)
    return Pair(Uri.fromFile(file), file.parent ?: "Bushmesh")
  }

  private fun sanitizeFilename(
    value: String,
    extension: String,
    fallbackName: String,
  ): String {
    val base = value
      .trim()
      .replace(Regex("[^A-Za-z0-9._-]"), "_")
      .take(120)
      .ifBlank { fallbackName }

    return if (base.lowercase().endsWith(extension)) base else "$base$extension"
  }
}
