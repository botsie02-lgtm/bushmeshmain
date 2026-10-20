package com.bushmeshmain.radio

import android.content.ContentValues
import android.content.Context
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
  }

  override fun getName(): String = "BushMeshExport"

  @ReactMethod
  fun saveGpx(displayName: String, content: String, promise: Promise) {
    try {
      val safeName = sanitizeFilename(displayName)
      val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        saveViaMediaStore(safeName, content)
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
      promise.reject("BUSHMESH_GPX_EXPORT_FAILED", error.message, error)
    }
  }

  private fun saveViaMediaStore(
    displayName: String,
    content: String,
  ): Pair<Uri, String> {
    val resolver = reactContext.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
      put(MediaStore.MediaColumns.MIME_TYPE, GPX_MIME)
      put(
        MediaStore.MediaColumns.RELATIVE_PATH,
        Environment.DIRECTORY_DOWNLOADS + "/Bushmesh",
      )
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }

    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("Android could not create the GPX export file.")

    try {
      resolver.openOutputStream(uri, "w")?.use { stream ->
        stream.write(content.toByteArray(StandardCharsets.UTF_8))
        stream.flush()
      } ?: throw IllegalStateException("Android could not open the GPX export file.")

      val published = ContentValues().apply {
        put(MediaStore.MediaColumns.IS_PENDING, 0)
      }
      resolver.update(uri, published, null, null)
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

  private fun sanitizeFilename(value: String): String {
    val base = value
      .trim()
      .replace(Regex("[^A-Za-z0-9._-]"), "_")
      .take(120)
      .ifBlank { "Bushmesh_Track.gpx" }

    return if (base.lowercase().endsWith(".gpx")) base else "$base.gpx"
  }
}
