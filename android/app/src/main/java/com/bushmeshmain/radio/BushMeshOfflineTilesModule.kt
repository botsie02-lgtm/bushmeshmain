package com.bushmeshmain.radio

import android.graphics.BitmapFactory
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Native, read-only, offline-only bridge. No JavaScript-supplied paths, HTTP,
 * online fallback or resident archive handles. Every call is checked against
 * the trusted native receipt created by BushMeshMapPacks after SHA-256.
 */
class BushMeshOfflineTilesModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val executor = ThreadPoolExecutor(
    2, 2, 30L, TimeUnit.SECONDS,
    ArrayBlockingQueue<Runnable>(48),
    ThreadPoolExecutor.AbortPolicy(),
  )

  override fun getName(): String = "BushMeshOfflineTiles"

  @ReactMethod
  fun readTileBase64(
    packId: String,
    manifestVersion: String,
    format: String,
    z: Int,
    x: Int,
    y: Int,
    promise: Promise,
  ) {
    if (!BushMeshTileCoordinates.valid(z, x, y)) {
      promise.resolve(null)
      return
    }
    try {
      executor.execute {
        try {
          val file = BushMeshVerifiedMapPackStore.resolve(
            reactContext.filesDir, packId, manifestVersion, format,
          )
          if (file == null) {
            promise.resolve(null)
            return@execute
          }
          val tile = when (format) {
            "pmtiles" -> BushMeshPmTilesReader.read(file, z, x, y)
            "mbtiles" -> BushMeshMbTilesReader.read(file, z, x, y)
            else -> null
          }
          if (tile == null || !validRaster(tile.first, tile.second)) {
            promise.resolve(null)
            return@execute
          }
          val result = Arguments.createMap().apply {
            putString("mimeType", tile.first)
            putString("base64", Base64.encodeToString(tile.second, Base64.NO_WRAP))
          }
          promise.resolve(result)
        } catch (_: Exception) {
          // Corrupt, unsupported or deleted archives must never produce fake
          // images or crash the UI. The React component shows missing tiles.
          promise.resolve(null)
        }
      }
    } catch (_: RejectedExecutionException) {
      promise.resolve(null)
    }
  }

  private fun validRaster(mimeType: String, bytes: ByteArray): Boolean {
    if (bytes.isEmpty() || bytes.size > 1024 * 1024) return false
    val prefixMatches = when (mimeType) {
      "image/png" -> bytes.size >= 24 &&
        bytes.copyOfRange(0, 8).contentEquals(
          byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
        )
      "image/jpeg" -> bytes.size >= 4 &&
        (bytes[0].toInt() and 0xff) == 0xff && (bytes[1].toInt() and 0xff) == 0xd8
      "image/webp" -> bytes.size >= 16 &&
        String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF" &&
        String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP"
      else -> false
    }
    if (!prefixMatches) return false
    // Read only image headers; never allocate a full bitmap in this bridge.
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    return options.outWidth in listOf(256, 512) &&
      options.outHeight in listOf(256, 512) && options.outMimeType == mimeType
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }
}
