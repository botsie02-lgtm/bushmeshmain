package com.bushmeshmain.radio

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

class BushMeshMapPackModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val CONNECT_TIMEOUT_MS = 15_000
    private const val READ_TIMEOUT_MS = 30_000
    private const val MAX_REDIRECTS = 5
    private const val BUFFER_BYTES = 64 * 1024
    private val PACK_ID_REGEX = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$")
    private val SHA256_REGEX = Regex("^[0-9A-Fa-f]{64}$")
  }

  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "BushMeshMapPacks"

  @ReactMethod
  fun downloadPack(
    packId: String,
    manifestVersion: String,
    sourceUrl: String,
    expectedBytesValue: Double,
    expectedSha256: String,
    format: String,
    promise: Promise,
  ) {
    executor.execute {
      try {
        val expectedBytes = validateExpectedBytes(expectedBytesValue)
        val normalizedFormat = validateInputs(packId, expectedSha256, format)
        val source = URL(sourceUrl)
        require(source.protocol.equals("https", ignoreCase = true)) {
          "Bushmesh map packs may only be downloaded over HTTPS."
        }

        val directory = packDirectory(packId)
        if (!directory.exists() && !directory.mkdirs()) {
          throw IllegalStateException("Could not create Bushmesh map-pack storage.")
        }

        val target = File(directory, "pack.$normalizedFormat")
        val partial = File(directory, "pack.$normalizedFormat.part")
        partial.delete()

        val digest = MessageDigest.getInstance("SHA-256")
        var totalBytes = 0L
        val connection = openHttpsConnection(source)
        try {
          val declaredLength = connection.contentLengthLong
          if (declaredLength > 0 && declaredLength != expectedBytes) {
            throw IllegalStateException(
              "Map-pack server length $declaredLength does not match manifest length $expectedBytes.",
            )
          }

          connection.inputStream.use { input ->
            FileOutputStream(partial).use { output ->
              val buffer = ByteArray(BUFFER_BYTES)
              while (true) {
                val count = input.read(buffer)
                if (count < 0) {
                  break
                }
                if (count == 0) {
                  continue
                }

                totalBytes += count.toLong()
                if (totalBytes > expectedBytes) {
                  throw IllegalStateException(
                    "Map-pack download exceeded the manifest byte length.",
                  )
                }

                digest.update(buffer, 0, count)
                output.write(buffer, 0, count)
              }
              output.fd.sync()
            }
          }
        } finally {
          connection.disconnect()
        }

        if (totalBytes != expectedBytes) {
          throw IllegalStateException(
            "Map-pack download length $totalBytes does not match manifest length $expectedBytes.",
          )
        }

        val actualSha256 = digest.digest().toHex()
        if (!actualSha256.equals(expectedSha256, ignoreCase = true)) {
          throw IllegalStateException("Map-pack SHA-256 verification failed.")
        }

        promoteVerifiedFile(partial, target)
        promise.resolve(
          artifactResult(
            packId = packId,
            manifestVersion = manifestVersion,
            format = normalizedFormat,
            file = target,
            bytes = totalBytes,
            sha256 = actualSha256,
            verifiedAtMs = System.currentTimeMillis(),
          ),
        )
      } catch (error: Exception) {
        try {
          packDirectory(packId).listFiles()
            ?.filter { file -> file.name.endsWith(".part") }
            ?.forEach { file -> file.delete() }
        } catch (_: Exception) {
          // Preserve the primary download/verification failure.
        }
        promise.reject("BUSHMESH_MAP_PACK_DOWNLOAD_FAILED", error.message, error)
      }
    }
  }

  @ReactMethod
  fun verifyPack(
    packId: String,
    manifestVersion: String,
    expectedBytesValue: Double,
    expectedSha256: String,
    format: String,
    promise: Promise,
  ) {
    executor.execute {
      try {
        val expectedBytes = validateExpectedBytes(expectedBytesValue)
        val normalizedFormat = validateInputs(packId, expectedSha256, format)
        val file = File(packDirectory(packId), "pack.$normalizedFormat")
        if (!file.isFile) {
          promise.resolve(null)
          return@execute
        }
        if (file.length() != expectedBytes) {
          promise.resolve(null)
          return@execute
        }

        val actualSha256 = sha256(file)
        if (!actualSha256.equals(expectedSha256, ignoreCase = true)) {
          promise.resolve(null)
          return@execute
        }

        promise.resolve(
          artifactResult(
            packId = packId,
            manifestVersion = manifestVersion,
            format = normalizedFormat,
            file = file,
            bytes = file.length(),
            sha256 = actualSha256,
            verifiedAtMs = System.currentTimeMillis(),
          ),
        )
      } catch (error: Exception) {
        promise.reject("BUSHMESH_MAP_PACK_VERIFY_FAILED", error.message, error)
      }
    }
  }

  @ReactMethod
  fun removePack(packId: String, promise: Promise) {
    executor.execute {
      try {
        require(PACK_ID_REGEX.matches(packId)) { "Invalid Bushmesh map-pack ID." }
        val directory = packDirectory(packId)
        val removed = !directory.exists() || directory.deleteRecursively()
        if (!removed) {
          throw IllegalStateException("Could not remove Bushmesh map-pack files.")
        }
        promise.resolve(true)
      } catch (error: Exception) {
        promise.reject("BUSHMESH_MAP_PACK_REMOVE_FAILED", error.message, error)
      }
    }
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  private fun validateExpectedBytes(value: Double): Long {
    require(value.isFinite() && value > 0 && value <= Long.MAX_VALUE.toDouble()) {
      "Invalid Bushmesh map-pack byte length."
    }
    val asLong = value.toLong()
    require(asLong.toDouble() == value) {
      "Bushmesh map-pack byte length must be an exact integer."
    }
    return asLong
  }

  private fun validateInputs(
    packId: String,
    expectedSha256: String,
    format: String,
  ): String {
    require(PACK_ID_REGEX.matches(packId)) { "Invalid Bushmesh map-pack ID." }
    require(SHA256_REGEX.matches(expectedSha256)) {
      "Invalid Bushmesh map-pack SHA-256."
    }
    val normalized = format.lowercase()
    require(normalized == "pmtiles" || normalized == "mbtiles") {
      "Bushmesh map-pack format must be PMTiles or MBTiles."
    }
    return normalized
  }

  private fun packDirectory(packId: String): File =
    File(reactContext.filesDir, "bushmesh-map-packs/$packId")

  private fun openHttpsConnection(initialUrl: URL): HttpURLConnection {
    var current = initialUrl
    repeat(MAX_REDIRECTS + 1) { redirectCount ->
      require(current.protocol.equals("https", ignoreCase = true)) {
        "Bushmesh map-pack redirects must remain on HTTPS."
      }

      val connection = current.openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.requestMethod = "GET"
      connection.setRequestProperty("Accept-Encoding", "identity")
      connection.setRequestProperty("User-Agent", "Bushmesh-Offline-Maps/1")

      val code = connection.responseCode
      if (code in 200..299) {
        return connection
      }

      if (code in 300..399 && redirectCount < MAX_REDIRECTS) {
        val location = connection.getHeaderField("Location")
          ?: throw IllegalStateException("Map-pack redirect omitted Location header.")
        val next = URL(current, location)
        connection.disconnect()
        current = next
        return@repeat
      }

      connection.disconnect()
      throw IllegalStateException("Map-pack server returned HTTP $code.")
    }

    throw IllegalStateException("Map-pack download exceeded the redirect limit.")
  }

  private fun promoteVerifiedFile(partial: File, target: File) {
    val backup = File(target.parentFile, "${target.name}.previous")
    backup.delete()

    if (target.exists() && !target.renameTo(backup)) {
      throw IllegalStateException("Could not stage the previous map pack for replacement.")
    }

    if (!partial.renameTo(target)) {
      if (backup.exists()) {
        backup.renameTo(target)
      }
      throw IllegalStateException("Could not atomically install the verified map pack.")
    }

    backup.delete()
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(BUFFER_BYTES)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) {
          break
        }
        if (count > 0) {
          digest.update(buffer, 0, count)
        }
      }
    }
    return digest.digest().toHex()
  }

  private fun ByteArray.toHex(): String =
    joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }

  private fun artifactResult(
    packId: String,
    manifestVersion: String,
    format: String,
    file: File,
    bytes: Long,
    sha256: String,
    verifiedAtMs: Long,
  ) = Arguments.createMap().apply {
    putString("packId", packId)
    putString("manifestVersion", manifestVersion)
    putString("format", format)
    putString("localUri", file.toURI().toString())
    putDouble("bytes", bytes.toDouble())
    putString("sha256", sha256)
    putDouble("verifiedAtMs", verifiedAtMs.toDouble())
  }
}
