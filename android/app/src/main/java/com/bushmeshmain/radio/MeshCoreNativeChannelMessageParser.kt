package com.bushmeshmain.radio

import java.nio.charset.StandardCharsets

/**
 * Minimal native parser for MeshCore channel text receive frames.
 *
 * This mirrors the companion protocol offsets already used by the React Native
 * parser, but deliberately extracts only fields needed by Android Auto and
 * background notifications. Display text is never treated as authenticated
 * sender identity.
 */
object MeshCoreNativeChannelMessageParser {
  private const val CHANNEL_MSG_RECV = 0x08
  private const val CHANNEL_MSG_RECV_V3 = 0x11

  data class Message(
    val channelIndex: Int,
    val text: String,
    val timestampSeconds: Long?,
    val pathLength: Int,
    val textType: Int,
    val snrDb: Double?,
  )

  fun parse(frame: ByteArray): Message? {
    if (frame.isEmpty()) {
      return null
    }

    val packetType = frame[0].toInt() and 0xff
    val isV3 = packetType == CHANNEL_MSG_RECV_V3
    if (!isV3 && packetType != CHANNEL_MSG_RECV) {
      return null
    }

    var offset = 1
    var snrDb: Double? = null

    if (isV3) {
      if (frame.size < 11) {
        return null
      }
      snrDb = signedByte(frame[offset]) / 4.0
      offset += 3
    } else if (frame.size < 8) {
      return null
    }

    if (frame.size < offset + 7) {
      return null
    }

    val channelIndex = frame[offset].toInt() and 0xff
    if (channelIndex !in 0..7) {
      return null
    }

    val pathLength = frame[offset + 1].toInt() and 0xff
    val textType = frame[offset + 2].toInt() and 0xff
    val timestampSeconds = readUInt32LE(frame, offset + 3)
    val text = String(
      frame,
      offset + 7,
      frame.size - (offset + 7),
      StandardCharsets.UTF_8,
    )
      .replace("\u0000", "")
      .trim()

    if (text.isEmpty()) {
      return null
    }

    return Message(
      channelIndex = channelIndex,
      text = text,
      timestampSeconds = timestampSeconds,
      pathLength = pathLength,
      textType = textType,
      snrDb = snrDb,
    )
  }

  private fun signedByte(value: Byte): Int {
    val unsigned = value.toInt() and 0xff
    return if (unsigned > 127) unsigned - 256 else unsigned
  }

  private fun readUInt32LE(bytes: ByteArray, offset: Int): Long? {
    if (offset < 0 || bytes.size < offset + 4) {
      return null
    }

    return (
      (bytes[offset].toLong() and 0xffL) or
        ((bytes[offset + 1].toLong() and 0xffL) shl 8) or
        ((bytes[offset + 2].toLong() and 0xffL) shl 16) or
        ((bytes[offset + 3].toLong() and 0xffL) shl 24)
      ) and 0xffffffffL
  }
}
