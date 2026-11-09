package com.bushmeshmain.radio

import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest

/**
 * Local archive copying is bounded and strictly compared with an
 * independently reviewed manifest. Caller must supply the stream from
 * ACTION_OPEN_DOCUMENT; this class does not receive filesystem paths from JS.
 */
internal object BushMeshLocalMapImport {
  private const val BUFFER_BYTES = 64 * 1024
  private const val PROGRESS_STEP = 1024 * 1024L
  private const val MAX_BYTES = 512L * 1024L * 1024L

  fun copyAndVerify(
    input: InputStream,
    partial: File,
    expectedBytes: Long,
    expectedSha256: String,
    cancelled: () -> Boolean = { false },
    progress: (Long) -> Unit = {},
  ) {
    require(expectedBytes in 1..MAX_BYTES) { "Unsupported import size." }
    require(Regex("^[0-9a-fA-F]{64}$").matches(expectedSha256)) {
      "Invalid expected SHA-256."
    }
    var count = 0L
    var lastProgress = 0L
    val digest = MessageDigest.getInstance("SHA-256")
    try {
      FileOutputStream(partial).use { out ->
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
          if (cancelled()) throw IllegalStateException("Map-pack import cancelled.")
          val n = input.read(buffer)
          if (n < 0) break
          if (n == 0) continue
          count += n
          require(count <= expectedBytes) { "Imported archive exceeds reviewed manifest byte length." }
          digest.update(buffer, 0, n)
          out.write(buffer, 0, n)
          if (count - lastProgress >= PROGRESS_STEP) {
            progress(count)
            lastProgress = count
          }
        }
        out.fd.sync()
      }
      require(!cancelled()) { "Map-pack import cancelled." }
      require(count == expectedBytes) { "Imported archive size does not match reviewed manifest." }
      val actual = digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
      require(actual.equals(expectedSha256, ignoreCase = true)) {
        "Imported archive SHA-256 does not match reviewed manifest."
      }
      progress(count)
    } catch (error: Exception) {
      partial.delete()
      throw error
    }
  }
}
