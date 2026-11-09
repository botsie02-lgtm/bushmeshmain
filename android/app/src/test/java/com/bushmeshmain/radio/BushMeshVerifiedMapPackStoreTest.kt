package com.bushmeshmain.radio

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class BushMeshVerifiedMapPackStoreTest {
  private fun root(): File = createTempDir(prefix = "bm-offline-test-")
  private fun hash(data: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(data).joinToString("") { "%02x".format(it.toInt() and 0xff) }

  @Test fun acceptsOnlyNativeVerifiedVersionAndUnchangedFile() {
    val folder = root()
    try {
      val dir = File(folder, "bushmesh-map-packs/valid-pack").apply { mkdirs() }
      val file = File(dir, "pack.mbtiles")
      val bytes = byteArrayOf(1, 2, 3, 4)
      file.writeBytes(bytes)
      BushMeshVerifiedMapPackStore.record(folder, "valid-pack", "v1", "mbtiles", 4L, hash(bytes))
      assertEquals(file, BushMeshVerifiedMapPackStore.resolve(folder, "valid-pack", "v1", "mbtiles"))
      assertNull(BushMeshVerifiedMapPackStore.resolve(folder, "valid-pack", "v2", "mbtiles"))
      assertNull(BushMeshVerifiedMapPackStore.resolve(folder, "valid-pack", "v1", "pmtiles"))
      assertNull(BushMeshVerifiedMapPackStore.resolve(folder, "../unsafe", "v1", "mbtiles"))
      // Same length but different bytes and changed mtime must fail the digest check.
      file.writeBytes(byteArrayOf(9, 9, 9, 9))
      file.setLastModified(file.lastModified() + 2_000)
      assertNull(BushMeshVerifiedMapPackStore.resolve(folder, "valid-pack", "v1", "mbtiles"))
    } finally { folder.deleteRecursively() }
  }

  @Test fun receiptInvalidatedOnRemoval() {
    val folder = root()
    try {
      val dir = File(folder, "bushmesh-map-packs/valid-pack").apply { mkdirs() }
      val file = File(dir, "pack.pmtiles")
      val data = byteArrayOf(1, 2, 3)
      file.writeBytes(data)
      BushMeshVerifiedMapPackStore.record(folder, "valid-pack", "v1", "pmtiles", 3L, hash(data))
      BushMeshVerifiedMapPackStore.forget(folder, "valid-pack")
      assertNull(BushMeshVerifiedMapPackStore.resolve(folder, "valid-pack", "v1", "pmtiles"))
    } finally { folder.deleteRecursively() }
  }
}
