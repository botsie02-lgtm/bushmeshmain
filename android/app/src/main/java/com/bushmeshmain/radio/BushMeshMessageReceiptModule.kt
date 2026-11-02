package com.bushmeshmain.radio

import android.content.Context
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONArray
import java.security.MessageDigest

/**
 * Small persistent replay registry for raw MeshCore message frames.
 *
 * Only SHA-256 fingerprints are stored; message contents are never written to
 * this registry. This prevents the same queued MeshCore channel frame from
 * being re-added to history after reconnect/process restart while keeping the
 * encrypted message-history store as the source of truth for actual content.
 */
class BushMeshMessageReceiptModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val PREFS_NAME = "bushmesh_message_receipts_v1"
    private const val RECEIPTS_KEY = "frame_sha256"
    private const val MAX_RECEIPTS = 512
    private const val MAX_FRAME_BYTES = 512
  }

  private val preferences by lazy {
    reactContext.applicationContext.getSharedPreferences(
      PREFS_NAME,
      Context.MODE_PRIVATE,
    )
  }

  override fun getName(): String = "BushMeshMessageReceipt"

  @ReactMethod
  @Synchronized
  fun claimFrame(base64Frame: String, promise: Promise) {
    try {
      val frame = Base64.decode(base64Frame, Base64.DEFAULT)
      require(frame.isNotEmpty() && frame.size <= MAX_FRAME_BYTES) {
        "MeshCore receipt frame is empty or too large."
      }

      val fingerprint = MessageDigest
        .getInstance("SHA-256")
        .digest(frame)
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

      val receipts = loadReceipts()
      if (receipts.contains(fingerprint)) {
        promise.resolve(false)
        return
      }

      receipts.add(fingerprint)
      while (receipts.size > MAX_RECEIPTS) {
        receipts.removeAt(0)
      }

      val array = JSONArray()
      receipts.forEach(array::put)
      val committed = preferences.edit()
        .putString(RECEIPTS_KEY, array.toString())
        .commit()
      if (!committed) {
        throw IllegalStateException("Bushmesh message receipt registry could not be persisted.")
      }

      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_MESSAGE_RECEIPT_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun getCount(promise: Promise) {
    try {
      promise.resolve(loadReceipts().size)
    } catch (error: Exception) {
      promise.reject("BUSHMESH_MESSAGE_RECEIPT_READ_FAILED", error.message, error)
    }
  }

  @Synchronized
  private fun loadReceipts(): MutableList<String> {
    val encoded = preferences.getString(RECEIPTS_KEY, null) ?: return mutableListOf()
    return try {
      val array = JSONArray(encoded)
      val receipts = mutableListOf<String>()
      for (index in 0 until array.length()) {
        val value = array.optString(index, "")
        if (value.matches(Regex("^[0-9a-f]{64}$"))) {
          receipts.add(value)
        }
      }
      receipts.takeLast(MAX_RECEIPTS).toMutableList()
    } catch (_: Exception) {
      preferences.edit().remove(RECEIPTS_KEY).commit()
      mutableListOf()
    }
  }
}
