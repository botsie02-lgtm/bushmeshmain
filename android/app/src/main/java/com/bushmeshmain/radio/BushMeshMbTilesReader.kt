package com.bushmeshmain.radio

import android.database.sqlite.SQLiteDatabase
import java.io.File

/** MBTiles 1.3: SQLite raster BLOBs indexed using TMS (bottom-origin) rows. */
internal object BushMeshMbTilesReader {
  private const val MAX_TILE_BYTES = 1024 * 1024

  fun read(file: File, z: Int, x: Int, y: Int): Pair<String, ByteArray>? {
    val flags = SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS
    val db = SQLiteDatabase.openDatabase(file.absolutePath, null, flags)
    try {
      val format = db.rawQuery(
        "SELECT value FROM metadata WHERE name = 'format' LIMIT 1", null,
      ).use { cursor -> if (cursor.moveToFirst()) cursor.getString(0)?.lowercase() else null }
      val mimeType = when (format) {
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        else -> throw IllegalArgumentException("Unsupported MBTiles raster format: $format")
      }
      // The size condition is applied by SQLite before a BLOB reaches Java.
      val row = BushMeshTileCoordinates.tmsRow(z, y)
      val args = arrayOf(z.toString(), x.toString(), row.toString())
      val bytes = db.rawQuery(
        "SELECT CASE WHEN length(tile_data) BETWEEN 1 AND $MAX_TILE_BYTES THEN tile_data ELSE NULL END " +
          "FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ? LIMIT 1",
        args,
      ).use { cursor ->
        if (!cursor.moveToFirst() || cursor.isNull(0)) null else cursor.getBlob(0)
      } ?: return null
      return mimeType to bytes
    } finally {
      db.close()
    }
  }
}
