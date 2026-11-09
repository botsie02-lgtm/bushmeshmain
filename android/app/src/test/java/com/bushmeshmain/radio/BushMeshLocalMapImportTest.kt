package com.bushmeshmain.radio

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.security.MessageDigest

class BushMeshLocalMapImportTest {
  private fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xff) }

  @Test fun copiesAndVerifiesRealBytes() {
    val input = byteArrayOf(1, 2, 3, 4, 5, 6)
    val file = File.createTempFile("bushmesh-import", ".part")
    try {
      BushMeshLocalMapImport.copyAndVerify(
        ByteArrayInputStream(input), file, input.size.toLong(), digest(input),
      )
      assertArrayEquals(input, file.readBytes())
    } finally {
      file.delete()
    }
  }

  @Test fun rejectsWrongHashAndDeletesUnverifiedPartial() {
    val input = byteArrayOf(1, 2, 3)
    val file = File.createTempFile("bushmesh-import", ".part")
    try {
      BushMeshLocalMapImport.copyAndVerify(
        ByteArrayInputStream(input), file, input.size.toLong(), "0".repeat(64),
      )
      fail("Digest mismatch must fail.")
    } catch (_: IllegalArgumentException) {
      assertFalse(file.exists())
    } finally {
      file.delete()
    }
  }

  @Test fun rejectsOversizedStreamAndDeletesPartial() {
    val bytes = byteArrayOf(1, 2, 3, 4)
    val file = File.createTempFile("bushmesh-import", ".part")
    try {
      BushMeshLocalMapImport.copyAndVerify(ByteArrayInputStream(bytes), file, 3L, digest(bytes))
      fail("Oversized input must fail.")
    } catch (_: IllegalArgumentException) {
      assertFalse(file.exists())
    } finally {
      file.delete()
    }
  }

  @Test fun userCancelPreventsPromotion() {
    val bytes = byteArrayOf(1, 2, 3)
    val file = File.createTempFile("bushmesh-import", ".part")
    try {
      BushMeshLocalMapImport.copyAndVerify(
        ByteArrayInputStream(bytes), file, 3L, digest(bytes),
        cancelled = { true },
      )
      fail("Cancelled import must fail.")
    } catch (_: IllegalStateException) {
      assertFalse(file.exists())
    } finally {
      file.delete()
    }
  }
}
