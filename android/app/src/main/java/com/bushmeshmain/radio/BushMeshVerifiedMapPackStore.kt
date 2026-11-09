package com.bushmeshmain.radio

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.Properties

/** Native-only receipt created after the installer has checked length + SHA-256. */
internal object BushMeshVerifiedMapPackStore {
  private val idPattern = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$")
  private val shaPattern = Regex("^[0-9a-fA-F]{64}$")
  private data class DigestKey(val path: String, val size: Long, val modified: Long, val sha: String)
  private val validated = HashSet<DigestKey>()

  private fun directory(filesDir: File, packId: String): File {
    require(idPattern.matches(packId)) { "Invalid BushMesh map-pack ID." }
    val root = File(filesDir.canonicalFile, "bushmesh-map-packs")
    val folder = File(root, packId)
    require(folder.canonicalPath == folder.absolutePath) { "Map-pack storage symlink refused." }
    return folder
  }

  private fun checkedFile(folder: File, format: String): File {
    require(format == "mbtiles" || format == "pmtiles") { "Invalid map-pack format." }
    val file = File(folder, "pack.$format")
    require(file.canonicalPath == file.absolutePath && file.isFile) {
      "Map-pack file is missing or unsafe."
    }
    return file
  }

  /** Record only after a successful native installer hash verification. */
  @Synchronized
  fun record(
    filesDir: File,
    packId: String,
    version: String,
    format: String,
    byteLength: Long,
    sha256: String,
  ) {
    require(version.isNotBlank() && version.length <= 120 && shaPattern.matches(sha256)) {
      "Invalid native verified-pack metadata."
    }
    val folder = directory(filesDir, packId)
    val file = checkedFile(folder, format)
    require(file.length() == byteLength && byteLength > 0) {
      "Verified map-pack length changed before receipt creation."
    }
    val props = Properties().apply {
      setProperty("schema", "1")
      setProperty("id", packId)
      setProperty("version", version)
      setProperty("format", format)
      setProperty("bytes", byteLength.toString())
      setProperty("sha256", sha256.lowercase())
      setProperty("modified", file.lastModified().toString())
    }
    val target = File(folder, "pack.verified")
    val partial = File(folder, "pack.verified.part")
    partial.delete()
    FileOutputStream(partial).use { output ->
      props.store(output, "BushMesh native verified pack — not a JS manifest")
      output.fd.sync()
    }
    if (target.exists() && !target.delete()) {
      partial.delete()
      throw IllegalStateException("Could not replace old map-pack verification receipt.")
    }
    if (!partial.renameTo(target)) {
      partial.delete()
      throw IllegalStateException("Could not commit map-pack verification receipt.")
    }
    validated.removeAll { it.path == file.absolutePath }
  }

  @Synchronized
  fun forget(filesDir: File, packId: String) {
    val folder = directory(filesDir, packId)
    File(folder, "pack.verified").delete()
    File(folder, "pack.verified.part").delete()
    validated.removeAll { it.path.startsWith(folder.absolutePath + File.separator) }
  }

  /** Full SHA-256 is checked on first read per process and when file stat changes. */
  @Synchronized
  fun resolve(filesDir: File, packId: String, version: String, format: String): File? {
    if (!idPattern.matches(packId) || version.isBlank() || version.length > 120 ||
      (format != "pmtiles" && format != "mbtiles")) return null
    val folder = directory(filesDir, packId)
    val receipt = File(folder, "pack.verified")
    if (!receipt.isFile || receipt.canonicalPath != receipt.absolutePath || receipt.length() > 4096) return null
    val props = Properties()
    try {
      FileInputStream(receipt).use { props.load(it) }
      if (props.getProperty("schema") != "1" || props.getProperty("id") != packId ||
        props.getProperty("version") != version || props.getProperty("format") != format) return null
      val bytes = props.getProperty("bytes")?.toLongOrNull() ?: return null
      val modified = props.getProperty("modified")?.toLongOrNull() ?: return null
      val expectedHash = props.getProperty("sha256") ?: return null
      if (!shaPattern.matches(expectedHash) || bytes <= 0) return null
      val file = checkedFile(folder, format)
      if (file.length() != bytes || file.lastModified() != modified) return null
      val key = DigestKey(file.absolutePath, bytes, modified, expectedHash.lowercase())
      if (!validated.contains(key)) {
        if (!digest(file).equals(expectedHash, ignoreCase = true)) return null
        // Fail closed if the archive changed while being verified.
        if (!file.isFile || file.length() != bytes || file.lastModified() != modified) return null
        validated.add(key)
        if (validated.size > 64) validated.clear()
      }
      return file
    } catch (_: Exception) {
      return null
    }
  }

  private fun digest(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { stream ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = stream.read(buffer)
        if (read < 0) break
        if (read > 0) digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }
}
