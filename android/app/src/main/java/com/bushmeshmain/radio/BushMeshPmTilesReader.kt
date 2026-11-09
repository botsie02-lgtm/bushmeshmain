package com.bushmeshmain.radio

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.GZIPInputStream

/** Read-only PMTiles v3 raster decoder. No network or unbounded archive reads. */
internal object BushMeshPmTilesReader {
  private const val HEADER_BYTES = 127
  private const val MAX_DIRECTORY_BYTES = 2 * 1024 * 1024
  private const val MAX_RASTER_BYTES = 1024 * 1024
  private const val MAX_DIRECTORY_ENTRIES = 100_000
  private const val MAX_LEAF_DEPTH = 4

  private data class Section(val offset: Long, val length: Long)
  private data class Header(
    val root: Section,
    val leaves: Section,
    val tiles: Section,
    val internalCompression: Int,
    val tileCompression: Int,
    val mimeType: String,
    val minZoom: Int,
    val maxZoom: Int,
  )
  private data class Entry(val id: Long, val offset: Long, val length: Long, val run: Long)

  fun read(file: File, z: Int, x: Int, y: Int): Pair<String, ByteArray>? =
    RandomAccessFile(file, "r").use { raf ->
      if (raf.length() < HEADER_BYTES) return null
      val header = parseHeader(raf)
      if (z !in header.minZoom..header.maxZoom) return null
      val tileId = hilbertTileId(z, x, y)
      var entries = readDirectory(raf, header.root, header.internalCompression)
      repeat(MAX_LEAF_DEPTH + 1) { depth ->
        val entry = findEntry(entries, tileId) ?: return null
        if (entry.run > 0) {
          if (tileId - entry.id >= entry.run) return null
          val bytes = decode(
            readSection(raf, header.tiles, entry.offset, entry.length, MAX_RASTER_BYTES),
            header.tileCompression,
            MAX_RASTER_BYTES,
          )
          return header.mimeType to bytes
        }
        require(depth < MAX_LEAF_DEPTH) { "PMTiles leaf directory nesting exceeds limit." }
        entries = readDirectory(
          raf,
          checkedSubsection(header.leaves, entry.offset, entry.length),
          header.internalCompression,
        )
      }
      null
    }

  /** XYZ tile coordinates mapped to the PMTiles v3 Hilbert ordering. */
  fun hilbertTileId(z: Int, x: Int, y: Int): Long {
    require(z in 0..24) { "Unsupported PMTiles zoom level." }
    val n = 1 shl z
    require(x in 0 until n && y in 0 until n) { "Invalid PMTiles XYZ coordinates." }
    var id = ((1L shl (2 * z)) - 1L) / 3L
    var xx = x
    var yy = y
    var side = n / 2
    while (side > 0) {
      val rx = if ((xx and side) != 0) 1 else 0
      val ry = if ((yy and side) != 0) 1 else 0
      id += side.toLong() * side * ((3 * rx) xor ry)
      if (ry == 0) {
        if (rx == 1) {
          xx = side - 1 - xx
          yy = side - 1 - yy
        }
        val temp = xx
        xx = yy
        yy = temp
      }
      side /= 2
    }
    return id
  }

  private fun parseHeader(raf: RandomAccessFile): Header {
    val bytes = ByteArray(HEADER_BYTES)
    raf.seek(0)
    raf.readFully(bytes)
    require(bytes.copyOfRange(0, 7).contentEquals("PMTiles".toByteArray(Charsets.US_ASCII)) &&
      (bytes[7].toInt() and 0xff) == 3) { "Unsupported PMTiles header/version." }
    val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    fun section(start: Int): Section {
      val offset = buffer.getLong(start)
      val length = buffer.getLong(start + 8)
      require(offset >= 0 && length >= 0 && offset <= raf.length() &&
        length <= raf.length() - offset) { "Invalid PMTiles section bounds." }
      return Section(offset, length)
    }
    val root = section(8)
    section(24) // metadata bounds must be valid even when unused
    val leaves = section(40)
    val tiles = section(56)
    require(root.offset >= HEADER_BYTES && root.length in 1..(16_384 - HEADER_BYTES).toLong() &&
      root.offset <= 16_384 - root.length) { "PMTiles root is outside the first 16KiB." }
    val internalCompression = bytes[97].toInt() and 0xff
    val tileCompression = bytes[98].toInt() and 0xff
    require(internalCompression in 1..2 && tileCompression in 1..2) {
      "Unsupported PMTiles compression (only none/gzip)."
    }
    val mimeType = when (bytes[99].toInt() and 0xff) {
      2 -> "image/png"
      3 -> "image/jpeg"
      4 -> "image/webp"
      else -> throw IllegalArgumentException("PMTiles tile type is not supported raster imagery.")
    }
    val minZoom = bytes[100].toInt() and 0xff
    val maxZoom = bytes[101].toInt() and 0xff
    require(minZoom <= maxZoom && maxZoom <= 24) { "Invalid PMTiles zoom metadata." }
    return Header(root, leaves, tiles, internalCompression, tileCompression,
      mimeType, minZoom, maxZoom)
  }

  private fun checkedSubsection(parent: Section, offset: Long, length: Long): Section {
    require(offset >= 0 && length in 1..MAX_DIRECTORY_BYTES.toLong() &&
      offset <= parent.length && length <= parent.length - offset) {
      "PMTiles directory references bytes outside its section."
    }
    return Section(parent.offset + offset, length)
  }

  private fun readSection(
    raf: RandomAccessFile,
    parent: Section,
    offset: Long,
    length: Long,
    maxBytes: Int,
  ): ByteArray {
    require(offset >= 0 && length in 1..maxBytes.toLong() && offset <= parent.length &&
      length <= parent.length - offset) { "PMTiles entry exceeds its section or memory limit." }
    val bytes = ByteArray(length.toInt())
    raf.seek(parent.offset + offset)
    raf.readFully(bytes)
    return bytes
  }

  private fun readDirectory(raf: RandomAccessFile, section: Section, compression: Int): List<Entry> {
    val compressed = readSection(raf, section, 0, section.length, MAX_DIRECTORY_BYTES)
    val bytes = decode(compressed, compression, MAX_DIRECTORY_BYTES)
    var position = 0
    fun varint(): Long {
      var value = 0L
      var shift = 0
      while (shift <= 63) {
        require(position < bytes.size) { "Truncated PMTiles directory varint." }
        val b = bytes[position++].toInt() and 0xff
        require(!(shift == 63 && b > 1)) { "PMTiles directory varint overflow." }
        value = value or ((b and 0x7f).toLong() shl shift)
        if ((b and 0x80) == 0) {
          require(value >= 0) { "PMTiles directory negative varint." }
          return value
        }
        shift += 7
      }
      throw IllegalArgumentException("PMTiles directory varint too long.")
    }
    val countValue = varint()
    require(countValue in 1..MAX_DIRECTORY_ENTRIES.toLong()) {
      "Invalid PMTiles directory entry count."
    }
    val count = countValue.toInt()
    val ids = LongArray(count)
    val runs = LongArray(count)
    val lengths = LongArray(count)
    val offsets = LongArray(count)
    var previousId = 0L
    for (i in 0 until count) {
      val delta = varint()
      require(delta > 0 || i == 0) { "PMTiles directory IDs must be strictly increasing." }
      require(previousId <= Long.MAX_VALUE - delta) { "PMTiles tile ID overflow." }
      previousId += delta
      ids[i] = previousId
    }
    for (i in 0 until count) runs[i] = varint()
    for (i in 0 until count) {
      lengths[i] = varint()
      require(lengths[i] > 0) { "PMTiles directory has zero-length content." }
    }
    for (i in 0 until count) {
      val stored = varint()
      offsets[i] = if (stored == 0L && i > 0) {
        require(offsets[i - 1] <= Long.MAX_VALUE - lengths[i - 1]) {
          "PMTiles directory offset overflow."
        }
        offsets[i - 1] + lengths[i - 1]
      } else {
        require(stored > 0) { "Invalid PMTiles first-entry offset." }
        stored - 1
      }
    }
    require(position == bytes.size) { "Trailing garbage in PMTiles directory." }
    return List(count) { i -> Entry(ids[i], offsets[i], lengths[i], runs[i]) }
  }

  private fun findEntry(entries: List<Entry>, tileId: Long): Entry? {
    var low = 0
    var high = entries.size - 1
    while (low <= high) {
      val mid = (low + high).ushr(1)
      if (entries[mid].id <= tileId) low = mid + 1 else high = mid - 1
    }
    return if (high >= 0) entries[high] else null
  }

  private fun decode(bytes: ByteArray, compression: Int, maxBytes: Int): ByteArray {
    if (compression == 1) return bytes
    require(compression == 2) { "Unsupported PMTiles compression." }
    return GZIPInputStream(ByteArrayInputStream(bytes)).use { input ->
      val output = ByteArrayOutputStream()
      val buffer = ByteArray(8192)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        require(output.size() + count <= maxBytes) { "Decompressed PMTiles data exceeds limit." }
        output.write(buffer, 0, count)
      }
      output.toByteArray()
    }
  }
}
