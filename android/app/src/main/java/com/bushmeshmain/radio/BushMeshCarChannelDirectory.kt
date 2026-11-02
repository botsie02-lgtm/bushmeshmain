package com.bushmeshmain.radio

import android.content.Context
import org.json.JSONObject

/**
 * Persists only non-secret channel display names for native car notifications.
 * Channel keys/secrets never cross this boundary.
 */
class BushMeshCarChannelDirectory(context: Context) {
  companion object {
    private const val PREFS_NAME = "bushmesh_car_channel_directory_v1"
    private const val CHANNELS_KEY = "channel_names"
    private const val MAX_NAME_CHARS = 80
  }

  private val preferences = context.applicationContext.getSharedPreferences(
    PREFS_NAME,
    Context.MODE_PRIVATE,
  )

  @Synchronized
  fun replace(entries: Map<Int, String>) {
    val root = JSONObject()
    entries.forEach { (index, rawName) ->
      if (index !in 0..7) {
        return@forEach
      }
      val name = rawName.trim().take(MAX_NAME_CHARS)
      if (name.isNotEmpty() && !name.equals("Empty", ignoreCase = true)) {
        root.put(index.toString(), name)
      }
    }

    val committed = preferences.edit()
      .putString(CHANNELS_KEY, root.toString())
      .commit()
    if (!committed) {
      throw IllegalStateException("Bushmesh car channel directory could not be persisted.")
    }
  }

  @Synchronized
  fun nameFor(channelIndex: Int): String {
    if (channelIndex !in 0..7) {
      return "Channel $channelIndex"
    }

    val raw = preferences.getString(CHANNELS_KEY, null)
      ?: return "Channel $channelIndex"
    return try {
      JSONObject(raw)
        .optString(channelIndex.toString(), "")
        .trim()
        .takeIf { it.isNotEmpty() }
        ?: "Channel $channelIndex"
    } catch (_: Exception) {
      preferences.edit().remove(CHANNELS_KEY).commit()
      "Channel $channelIndex"
    }
  }
}