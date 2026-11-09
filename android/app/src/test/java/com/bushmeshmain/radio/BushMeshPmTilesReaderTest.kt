package com.bushmeshmain.radio

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.GZIPOutputStream

class BushMeshPmTilesReaderTest {
  private fun varint(value: Long): ByteArray {
    var n = value
    val bytes = ByteArrayOutputStream()
    while (n >= 128) {
      bytes.write(((n and 0x7f) or 0x80).toInt())
      n = n ushr 7
    }
    bytes.write(n.toInt())
    return bytes.toByteArray()
  }

  private fun directory(id: Long, run: Long, length: Long, offset: Long): ByteArray =
    ByteArrayOutputStream().apply {
      write(varint(1))
      write(varint(id))
      write(varint(run))
      write(varint(length))
      write(varint(offset + 1))
    }.toByteArray()

  private fun gzip(bytes: ByteArray): ByteArray =
    ByteArrayOutputStream().apply { GZIPOutputStream(this).use { it.write(bytes) } }.toByteArray()

  /** Representative in-memory PMTiles v3 archive: header + root + optional leaf + raster. */
  private fun fixture(
    tile: ByteArray = byteArrayOf(1, 2, 3, 4, 5),
    gzipDir: Boolean = true,
    gzipTile: Boolean = false,
    leaf: Boolean = false,
    tileType: Int = 2,
  ): File {
    val raster = if (gzipTile) gzip(tile) else tile
    val leafBytes = if (leaf) {
      val raw = directory(4, 1, raster.size.toLong(), 0)
      if (gzipDir) gzip(raw) else raw
    } else byteArrayOf()
    val rootRaw = directory(if (leaf) 1 else 4, if (leaf) 0 else 1,
      if (leaf) leafBytes.size.toLong() else raster.size.toLong(), 0)
    val root = if (gzipDir) gzip(rootRaw) else rootRaw
    val header = ByteBuffer.allocate(127).order(ByteOrder.LITTLE_ENDIAN)
    header.put("PMTiles".toByteArray(Charsets.US_ASCII))
    header.put(3.toByte())
    val rootStart = 127L
    val leafStart = rootStart + root.size
    val tileStart = leafStart + leafBytes.size
    for (v in longArrayOf(rootStart, root.size.toLong(), leafStart, 0,
      leafStart, leafBytes.size.toLong(), tileStart, raster.size.toLong(),
      1, 1, 1)) header.putLong(v)
    header.put(1.toByte()) // clustered
    header.put((if (gzipDir) 2 else 1).toByte())
    header.put((if (gzipTile) 2 else 1).toByte())
    header.put(tileType.toByte())
    header.put(0.toByte())
    header.put(8.toByte())
    val file = File.createTempFile("bushmesh-pmtiles-test", ".pmtiles")
    file.deleteOnExit()
    file.outputStream().use {
      it.write(header.array())
      it.write(root)
      it.write(leafBytes)
      it.write(raster)
    }
    return file
  }

  @Test fun hilbertMatchesOfficialZoomOneReference() {
    assertEquals(0L, BushMeshPmTilesReader.hilbertTileId(0, 0, 0))
    assertEquals(1L, BushMeshPmTilesReader.hilbertTileId(1, 0, 0))
    assertEquals(2L, BushMeshPmTilesReader.hilbertTileId(1, 0, 1))
    assertEquals(3L, BushMeshPmTilesReader.hilbertTileId(1, 1, 1))
    assertEquals(4L, BushMeshPmTilesReader.hilbertTileId(1, 1, 0))
  }

  @Test fun readsRasterFromUncompressedDirectory() {
    val result = BushMeshPmTilesReader.read(fixture(gzipDir = false), 1, 1, 0)
    assertEquals("image/png", result?.first)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5), result?.second)
  }

  @Test fun readsGzipLeafDirectoryAndGzipTile() {
    val result = BushMeshPmTilesReader.read(fixture(gzipDir = true, gzipTile = true, leaf = true), 1, 1, 0)
    assertEquals("image/png", result?.first)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5), result?.second)
  }

  @Test fun returnsNullForAbsentTile() {
    assertNull(BushMeshPmTilesReader.read(fixture(), 1, 0, 0))
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsVectorTiles() {
    BushMeshPmTilesReader.read(fixture(tileType = 1), 1, 1, 0)
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsMalformedHeaderBounds() {
    val file = fixture()
    java.io.RandomAccessFile(file, "rw").use {
      it.seek(8)
      it.writeLong(java.lang.Long.reverseBytes(9_999_999L))
    }
    BushMeshPmTilesReader.read(file, 1, 1, 0)
  }
}
