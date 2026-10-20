package com.bushmeshmain.radio

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import java.security.MessageDigest

/**
 * Separate replay registry for Android Auto notifications.
 *
 * This is intentionally independent from the message-history receipt registry:
 * consuming a car notification must never prevent React Native from later
 * persisting the same radio message into encrypted history.
 */
class BushMeshCarNotificationReceiptStore(context: Context) {
  companion object {
    private const val PREFS_NAME = "bushmesh_car_notification_receipts_v1"
    private const val RECEIPTS_KEY = "frame_sha256"
    private const val MAX_RECEIPTS = 512
  }

  private val preferences = context.applicationContext.getSharedPreferences(
    PREFS_NAME,
    Context.MODE_PRIVATE,
  )

  @Synchronized
  fun claim(frame: ByteArray): Boolean {
    if (frame.isEmpty()) {
      return false
    }

    val fingerprint = MessageDigest
      .getInstance("SHA-256")
      .digest(frame)
      .let { Base64.encodeToString(it, Base64.NO_WRAP) }

    val receipts = load()
    if (receipts.contains(fingerprint)) {
      return false
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
      throw IllegalStateException("Bushmesh Auto notification receipt could not be persisted.")
    }
    return true
  }

  @Synchronized
  fun count(): Int = load().size

  private fun load(): MutableList<String> {
    val raw = preferences.getString(RECEIPTS_KEY, null) ?: return mutableListOf()
    return try {
      val array = JSONArray(raw)
      val result = mutableListOf<String>()
      for (index in 0 until array.length()) {
        val value = array.optString(index, "")
        if (value.isNotBlank()) {
          result.add(value)
        }
      }
      result.takeLast(MAX_RECEIPTS).toMutableList()
    } catch (_: Exception) {
      preferences.edit().remove(RECEIPTS_KEY).commit()
      mutableListOf()
    }
  }
}
