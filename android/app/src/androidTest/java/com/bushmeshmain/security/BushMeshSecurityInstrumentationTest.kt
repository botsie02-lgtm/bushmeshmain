package com.bushmeshmain.security

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry

/** Runs ONLY on a device/emulator via :app:connectedDebugAndroidTest. */
@RunWith(AndroidJUnit4::class)
class BushMeshSecurityInstrumentationTest {
  private lateinit var context: Context
  private lateinit var filename: String
  private lateinit var keyAlias: String
  private lateinit var core: BushMeshSecurityCore

  @Before fun setUp() {
    context = InstrumentationRegistry.getInstrumentation().targetContext
    val suffix = UUID.randomUUID().toString().replace("-", "")
    filename = "bushmesh_security_test_" + suffix + ".db"
    keyAlias = "bushmesh_security_test_aes_" + suffix
    core = BushMeshSecurityCore(context, filename, keyAlias)
  }

  @After fun tearDown() {
    core.close()
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (keyStore.containsAlias(keyAlias)) keyStore.deleteEntry(keyAlias)
    val file = File(context.noBackupFilesDir, filename)
    listOf(file, File(file.path + "-journal"), File(file.path + "-wal"),
      File(file.path + "-shm")).forEach { it.delete() }
  }

  @Test fun encryptedAtRestAndRestartRecovery() {
    val sensitive = "group-epoch-secret-should-not-appear-in-sqlite".toByteArray()
    core.put("secret", "group/test/epoch-1", sensitive)
    core.put("meta", "peer/test", "{\"trustState\":\"trusted\"}".toByteArray())
    assertArrayEquals(sensitive, core.get("secret", "group/test/epoch-1"))
    val raw = File(context.noBackupFilesDir, filename).readBytes()
    assertFalse(String(raw, Charsets.ISO_8859_1).contains(String(sensitive)))
    assertTrue(core.storageSecurityLevel() in listOf("tee", "strongbox", "hardware-unclassified"))
    core.close()
    core = BushMeshSecurityCore(context, filename, keyAlias)
    assertArrayEquals(sensitive, core.get("secret", "group/test/epoch-1"))
    core.remove("secret", "group/test/epoch-1")
    assertNull(core.get("secret", "group/test/epoch-1"))
  }

  @Test fun durableConcurrentNoncesReplayAndHandshakeConsumption() {
    val executor = Executors.newFixedThreadPool(6)
    try {
      val issued = executor.invokeAll((1..48).map {
        Callable { core.reserveNonce("nonce/test", "0").toLong() }
      }).map { it.get() }.toSet()
      assertEquals(48, issued.size)
      assertEquals(48L, issued.maxOrNull())
      assertEquals("48", core.getHigh("nonce/test"))
      assertTrue(core.acceptReplay("replay/test", "100", 128))
      assertTrue(core.acceptReplay("replay/test", "99", 128))
      assertFalse(core.acceptReplay("replay/test", "100", 128))
      assertTrue(core.consumeHandshake("handshake-1", System.currentTimeMillis() + 60000))
      assertFalse(core.consumeHandshake("handshake-1", System.currentTimeMillis() + 60000))
      core.close()
      core = BushMeshSecurityCore(context, filename, keyAlias)
      assertEquals("49", core.reserveNonce("nonce/test", "0"))
      assertFalse(core.acceptReplay("replay/test", "99", 128))
      assertFalse(core.consumeHandshake("handshake-1", System.currentTimeMillis() + 60000))
    } finally {
      executor.shutdownNow()
    }
  }

  @Test fun epochCasAndIdempotencyPersistAcrossRestart() {
    val group = "bmg1_testGroup001"
    val record = JSONObject().put("groupId", group).put("currentEpoch", 1).toString()
    assertTrue(core.commitEpoch("tx001", group, "digest001", 0, 1, record,
      "group/test/epoch-1", ByteArray(32) { 1 }))
    assertEquals(1, core.epochHigh(group))
    assertFalse(core.commitEpoch("tx001", group, "digest001", 0, 1, record,
      "group/test/epoch-1", ByteArray(32) { 1 }))
    assertThrows(IllegalStateException::class.java) {
      core.commitEpoch("tx001", group, "different", 0, 1, record,
        "group/test/epoch-1", ByteArray(32) { 1 })
    }
    assertThrows(IllegalArgumentException::class.java) {
      core.commitEpoch("tx002", group, "digest002", 0, 1, record,
        "group/test/epoch-1b", ByteArray(32) { 2 })
    }
    core.close()
    core = BushMeshSecurityCore(context, filename, keyAlias)
    assertEquals(1, core.epochHigh(group))
    assertArrayEquals(ByteArray(32) { 1 }, core.get("secret", "group/test/epoch-1"))
  }

  @Test fun corruptMetadataAndInterruptedWriteFailClosed() {
    val data = "previous-state".toByteArray()
    core.put("meta", "peer/old", data)
    core.close()
    val file = File(context.noBackupFilesDir, filename)
    val raw = SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READWRITE)
    raw.beginTransaction()
    try {
      raw.execSQL("DELETE FROM entries WHERE kind='meta' AND name='peer/old'")
      // Deliberate rollback: no setTransactionSuccessful().
    } finally {
      raw.endTransaction()
      raw.close()
    }
    core = BushMeshSecurityCore(context, filename, keyAlias)
    assertArrayEquals(data, core.get("meta", "peer/old"))
    core.close()
    val corrupt = SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READWRITE)
    corrupt.execSQL("UPDATE entries SET sealed=x'0001' WHERE kind='meta' AND name='peer/old'")
    corrupt.close()
    core = BushMeshSecurityCore(context, filename, keyAlias)
    assertThrows(IllegalStateException::class.java) { core.get("meta", "peer/old") }
  }

  @Test fun identityRetirementTombstoneSurvivesInterruptedCleanup() {
    val identity = JSONObject().put("keyEpoch", 1).toString()
    val signing = JSONObject().put("algorithm", "Ed25519").put("purpose", "identity-signing")
    val agreement = JSONObject().put("algorithm", "X25519").put("purpose", "identity-agreement")
    val handles = JSONObject().put("keyEpoch", 1)
      .put("signingPrivateKey", signing).put("agreementPrivateKey", agreement).toString()
    core.setIdentityAtomic(identity, handles)
    core.beginRetirement()
    assertThrows(IllegalStateException::class.java) { core.get("meta", "identity") }
    core.close()
    core = BushMeshSecurityCore(context, filename, keyAlias)
    assertTrue(core.isRetired())
    assertNotNull(core.retirementHandles())
    core.finishRetirement()
    assertNull(core.retirementHandles())
    assertThrows(IllegalArgumentException::class.java) {
      core.setIdentityAtomic(identity, handles)
    }
    assertThrows(IllegalStateException::class.java) { core.get("meta", "identityHandles") }
  }

  @Test fun curveKeysAreHardwareProbedAndNeverExported() {
    val keys = BushMeshCurve25519Keys(core)
    val report = keys.probe()
    // A skipped hardware test is not proof the device supports Curve25519.
    assumeTrue("Device has not passed exact hardware Ed25519/X25519 probe", report.getBoolean("enabled"))
    val signing = keys.create("Ed25519", "identity-signing")
    val agreement = keys.create("X25519", "identity-agreement")
    val handle = signing.getJSONObject("privateKeyHandle")
    val agreementHandle = agreement.getJSONObject("privateKeyHandle")
    try {
      val message = byteArrayOf(9, 8, 7)
      val public = android.util.Base64.decode(signing.getString("publicKey"), android.util.Base64.NO_WRAP)
      assertTrue(keys.verify(public, message, keys.sign(handle, message)))
      val forgedPurpose = JSONObject(handle.toString()).put("purpose", "session-ephemeral")
      assertThrows(IllegalArgumentException::class.java) { keys.sign(forgedPurpose, message) }
      val wrongAlgorithm = JSONObject(handle.toString()).put("algorithm", "X25519")
      assertThrows(IllegalArgumentException::class.java) { keys.agree(wrongAlgorithm, ByteArray(32)) }
      val recreated = BushMeshCurve25519Keys(core)
      assumeTrue(recreated.probe().getBoolean("enabled"))
      assertTrue(recreated.has(handle))
      assertTrue(recreated.has(agreementHandle))
      assertTrue(recreated.verify(public, message, recreated.sign(handle, message)))
    } finally {
      keys.delete(handle)
      keys.delete(agreementHandle)
    }
    assertFalse(keys.has(handle))
  }
}
