package com.bushmeshmain.radio

import android.util.JsonReader
import org.json.JSONObject
import java.io.StringReader

/** Independent authenticated marker, not a claim of hardware rollback protection. */
internal data class MessageRetentionGuard(val ids: Set<String>, val replay: Set<Pair<String, String>>) {
  fun includes(previous: MessageRetentionGuard): Boolean = ids.containsAll(previous.ids) && replay.containsAll(previous.replay)

  companion object {
    fun parse(value: String): MessageRetentionGuard {
      val json = JSONObject(value)
      require(json.getInt("version") == 1)
      val ids = json.getJSONArray("deletedIds")
      val replay = json.getJSONArray("possibleReplayKeys")
      return MessageRetentionGuard(
        (0 until ids.length()).map { ids.getString(it).also { id -> require(id.isNotEmpty() && id.length <= 256) } }.toSet(),
        (0 until replay.length()).map { i ->
          val row = replay.getJSONObject(i)
          val bucket = row.getString("bucket")
          val digest = row.getString("digest")
          require(bucket.isNotEmpty() && bucket.length <= 2048 && digest.matches(Regex("[a-f0-9]{64}")))
          Pair(bucket, digest)
        }.toSet(),
      )
    }

    // The current encoder writes retention before messages. Skip values
    // without building a second full message-object graph in native memory.
    fun fromSnapshot(snapshot: String): MessageRetentionGuard? {
      JsonReader(StringReader(snapshot)).use { reader ->
        reader.beginObject()
        while (reader.hasNext()) {
          if (reader.nextName() != "retention") {
            reader.skipValue()
            continue
          }
          var version: Int? = null
          val ids = mutableSetOf<String>()
          val replay = mutableSetOf<Pair<String, String>>()
          var haveIds = false
          var haveReplay = false
          reader.beginObject()
          while (reader.hasNext()) {
            when (reader.nextName()) {
              "version" -> version = reader.nextInt()
              "deletedIds" -> {
                require(!haveIds)
                haveIds = true
                reader.beginArray()
                while (reader.hasNext()) {
                  val id = reader.nextString()
                  require(id.isNotEmpty() && id.length <= 256)
                  ids.add(id)
                }
                reader.endArray()
              }
              "possibleReplayKeys" -> {
                require(!haveReplay)
                haveReplay = true
                reader.beginArray()
                while (reader.hasNext()) {
                  var bucket: String? = null
                  var digest: String? = null
                  reader.beginObject()
                  while (reader.hasNext()) {
                    when (reader.nextName()) {
                      "bucket" -> bucket = reader.nextString()
                      "digest" -> digest = reader.nextString()
                      else -> reader.skipValue()
                    }
                  }
                  reader.endObject()
                  val b = checkNotNull(bucket)
                  val d = checkNotNull(digest)
                  require(b.isNotEmpty() && b.length <= 2048 && d.matches(Regex("[a-f0-9]{64}")))
                  replay.add(Pair(b,d))
                }
                reader.endArray()
              }
              else -> reader.skipValue()
            }
          }
          reader.endObject()
          require(version == 1 && haveIds && haveReplay)
          return MessageRetentionGuard(ids, replay)
        }
        return null
      }
    }
  }
}
