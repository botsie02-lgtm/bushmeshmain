package com.bushmeshmain.radio

internal class HistoryCapacityException : IllegalStateException("History snapshot memory budget exceeded")

/** Conservative admission policy for the existing whole-snapshot store.
 * Not a tested capacity guarantee or automatic retention policy.
 * Bound absolute growth even on large heaps, leave room for React, other
 * runtime state and SharedPreferences XML copies. Re-evaluate free headroom
 * for every operation; never allocate a huge UTF-8 array merely to count it. */
internal object HistorySnapshotBudget {
  const val MAX_WRITE_BYTES = 16L * 1024 * 1024
  private const val RESERVE = 32L * 1024 * 1024
  fun utf8Bytes(text: String): Long {
    var bytes = 0L
    var i = 0
    while (i < text.length) {
      val c = text[i++]
      bytes += when {
        c.code < 0x80 -> 1
        c.code < 0x800 -> 2
        Character.isHighSurrogate(c) && i < text.length && Character.isLowSurrogate(text[i]) -> { i++; 4 }
        Character.isSurrogate(c) -> 1 // Java UTF-8 encoder replacement for an unpaired surrogate
        else -> 3
      }
    }
    return bytes
  }

  private fun available(): Long {
    val runtime = Runtime.getRuntime()
    return runtime.maxMemory() - (runtime.totalMemory() - runtime.freeMemory())
  }
  fun requireWrite(bytes: Long, heap: Long = Runtime.getRuntime().maxMemory(), free: Long = available()) {
    if (bytes < 0 || bytes > minOf(MAX_WRITE_BYTES, heap / 12) ||
      free < RESERVE || bytes > (free - RESERVE) / 8) throw HistoryCapacityException()
  }
  /** Legacy reads use headroom rather than the new-write absolute ceiling:
   * the envelope is already in memory; Base64 decode, AEAD provider buffers,
   * plaintext String and bridge copy still need capacity. */
  fun requireRestore(envelopeChars: Long, free: Long = available()) {
    if (envelopeChars < 0 || free < RESERVE || envelopeChars > (free - RESERVE) / 4)
      throw HistoryCapacityException()
  }
}
