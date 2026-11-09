package com.bushmeshmain.radio

import android.database.sqlite.SQLiteDatabase
import android.graphics.BitmapFactory
import java.io.File
import java.io.RandomAccessFile

/**
 * Lightweight format gate AFTER hashing and BEFORE native verification receipt.
 * Only an actual raster archive can reach 'Installed'. Full individual tile
 * decoding still occurs on demand in BushMeshOfflineTiles.
 */
internal object BushMeshRasterPackInspection {
  private const val MAX_SAMPLE_BYTES = 1024 * 1024

  fun assertRaster(file: File, format: String) {
    require(file.isFile && file.length() > 127) { "Invalid map archive: empty or truncated file." }
    when (format) {
      "mbtiles" -> assertMbtiles(file)
      "pmtiles" -> assertPmtiles(file)
      else -> throw IllegalArgumentException("Unsupported: unknown map archive format.")
    }
  }

  private fun assertMbtiles(file: File) {
    val db = SQLiteDatabase.openDatabase(
      file.absolutePath, null,
      SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS,
    )
    try {
      val value = db.rawQuery(
        "SELECT value FROM metadata WHERE name='format' LIMIT 1", null,
      ).use { if (it.moveToFirst()) it.getString(0)?.lowercase() else null }
      val mimeType = when (value) {
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        else -> throw IllegalArgumentException("Unsupported: MBTiles must contain PNG, JPEG or WebP raster imagery, not vector tiles.")
      }
      // Check a real sample without allocating an unbounded SQLite BLOB.
      val sample = db.rawQuery(
        "SELECT CASE WHEN length(tile_data) BETWEEN 1 AND $MAX_SAMPLE_BYTES " +
          "THEN tile_data ELSE NULL END FROM tiles LIMIT 1",
        null,
      ).use { cursor ->
        if (!cursor.moveToFirst() || cursor.isNull(0)) null else cursor.getBlob(0)
      } ?: throw IllegalArgumentException("Invalid MBTiles: no bounded raster tiles found.")
      val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(sample, 0, sample.size, options)
      require(options.outMimeType == mimeType &&
        options.outWidth in listOf(256, 512) && options.outHeight in listOf(256, 512)) {
        "Unsupported: MBTiles first image is not a supported 256/512-pixel raster tile."
      }
    } finally {
      db.close()
    }
  }

  private fun assertPmtiles(file: File) {
    RandomAccessFile(file, "r").use { raf ->
      if (raf.length() < 127) throw IllegalArgumentException("Invalid PMTiles v3 header.")
      val header = ByteArray(127)
      raf.readFully(header)
      require(String(header, 0, 7, Charsets.US_ASCII) == "PMTiles" &&
        (header[7].toInt() and 0xff) == 3) {
        "Unsupported: PMTiles v3 is required."
      }
      val internal = header[97].toInt() and 0xff
      val tileCompression = header[98].toInt() and 0xff
      val tileType = header[99].toInt() and 0xff
      require(internal in 1..2 && tileCompression in 1..2 &&
        tileType in 2..4) {
        "Unsupported: only raster PNG/JPEG/WebP PMTiles v3 with none/gzip compression is supported."
      }
      val minZoom = header[100].toInt() and 0xff
      val maxZoom = header[101].toInt() and 0xff
      require(minZoom <= maxZoom && maxZoom <= 24) {
        "Unsupported: PMTiles archive zoom metadata exceeds reader range."
      }
      // Root directory must lie inside the PMTiles v3 header's 16KiB root window.
      val rootOffset = littleEndianLong(header, 8)
      val rootLength = littleEndianLong(header, 16)
      require(rootOffset >= 127 && rootLength > 0 &&
        rootOffset <= 16_384 - rootLength && rootOffset <= raf.length() &&
        rootLength <= raf.length() - rootOffset) {
        "Invalid PMTiles: root directory is outside permitted header section."
      }
    }
  }

  private fun littleEndianLong(bytes: ByteArray, index: Int): Long {
    var value = 0L
    for (i in 0 until 8) {
      value = value or ((bytes[index + i].toLong() and 0xffL) shl (8 * i))
    }
    return value
  }
}
