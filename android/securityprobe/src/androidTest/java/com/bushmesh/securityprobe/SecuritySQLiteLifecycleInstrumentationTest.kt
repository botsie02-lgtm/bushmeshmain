package com.bushmesh.securityprobe

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteException
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.bushmeshmain.security.BushMeshSecurityCore
import java.io.File
import java.security.KeyStore
import java.util.UUID
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Device-backed regressions for the actual Galaxy S22+ SQLiteException:
 * execSQL("PRAGMA synchronous=FULL") must NEVER be used.
 *
 * All files and Keystore aliases belong exclusively to securityprobe's UID.
 */
@RunWith(AndroidJUnit4::class)
class SecuritySQLiteLifecycleInstrumentationTest {
  private lateinit var context: Context
  private lateinit var name: String
  private lateinit var alias: String
  private var core: BushMeshSecurityCore? = null

  @Before fun setUp() {
    context = InstrumentationRegistry.getInstrumentation().targetContext
    assertEquals(ProbeReport.APP_ID, context.packageName)
    val suffix = UUID.randomUUID().toString().replace("-", "")
    name = "securityprobe_sqlite_regression_$suffix.db"
    alias = "securityprobe_sqlite_regression_aes_$suffix"
  }

  private fun fresh(): BushMeshSecurityCore =
    BushMeshSecurityCore(context, name, alias).also { core = it }

  private fun path(): File = File(context.noBackupFilesDir, name)

  private fun assertFullConfiguration(instance: BushMeshSecurityCore) {
    val config = instance.sqliteDurability()
    assertEquals("SQLite FULL must be effective, not just requested", 2, config.synchronous)
    assertEquals("SQLite secure_delete must be enabled", 1, config.secureDelete)
    assertEquals("SQLite must use one-connection rollback journal", "delete", config.journalMode)
  }

  @After fun tearDown() {
    core?.close()
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
    for (suffix in listOf("", "-journal", "-wal", "-shm")) {
      File(path().absolutePath + suffix).delete()
    }
  }

  @Test fun freshOpenSetsAndVerifiesFullDurability() {
    val instance = fresh()
    assertFullConfiguration(instance)
    assertTrue(path().exists())
    assertTrue("Security schema must be initialized", path().length() > 0)
  }

  @Test fun protectedMetadataReadWriteUsesConfiguredDatabase() {
    val instance = fresh()
    val record = """{"state":"trusted","revision":1}""".toByteArray()
    instance.put("meta", "peer/sqlite-regression", record)
    assertArrayEquals(record, instance.get("meta", "peer/sqlite-regression"))
    assertFullConfiguration(instance)
  }

  @Test fun closingBeforeFirstAccessDoesNotCreateOrInitializeDatabase() {
    val instance = fresh()
    assertFalse(path().exists())
    instance.close()
    instance.close()
    assertFalse("close() must not cause lazy database initialization", path().exists())
    assertFalse(KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(alias))
  }

  @Test fun closingAfterInitializationIsSafeAndIdempotent() {
    val instance = fresh()
    assertFullConfiguration(instance)
    instance.close()
    instance.close()
    assertTrue("Closing an open DB does not delete persistent metadata", path().exists())
  }

  @Test fun rejectedSchemaPreservesOriginalErrorAndCleanupDoesNotReinitialize() {
    // Create an incompatible schema using Android's supported public API;
    // this simulates a deterministic failure AFTER SQLiteDatabase.openDatabase.
    SQLiteDatabase.openOrCreateDatabase(path(), null).use { raw ->
      raw.version = 99
    }
    val instance = fresh()
    val thrown = assertThrows(IllegalStateException::class.java) {
      instance.put("meta", "peer/should-not-write", byteArrayOf(7))
    }
    assertTrue(thrown.message.orEmpty().contains("Unsupported BushMesh security storage schema"))
    instance.close()
    instance.close()
    SQLiteDatabase.openOrCreateDatabase(path(), null).use { raw ->
      assertEquals("A failed init must NOT silently reset the DB", 99, raw.version)
    }
    assertFalse("A rejected schema must not create the wrapping key",
      KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(alias))
  }

  @Test fun sqliteOpenFailureIsNotReplacedByAnExceptionFromClose() {
    // A directory at the database path forces the platform to fail opening
    // SQLite before the lazy delegate can finish initializing.
    assertTrue(path().mkdir())
    val instance = fresh()
    val error = assertThrows(SQLiteException::class.java) {
      instance.get("meta", "peer/unavailable")
    }
    assertNotNull(error)
    // The first failure's class/message must survive and close() must not
    // attempt a second lazy open, corrupt the fixture, or mask the cause.
    instance.close()
    instance.close()
    assertTrue(path().isDirectory)
    val report = ProbeReport.inspect(context, name, alias)
    assertEquals("PROBE_FAILED_CLOSED", report.getString("classification"))
    val caps = report.getJSONObject("capabilities")
    assertTrue(caps.getString("failureClass").contains("SQLite"))
    assertFalse(caps.has("cleanupFailureClass"))
  }

  @Test fun successfulReopenPreservesMetadataAndFullDurability() {
    var instance = fresh()
    instance.put("meta", "peer/restart", byteArrayOf(31, 32, 33))
    assertEquals("1", instance.reserveNonce("scope/restart", "0"))
    assertTrue(instance.acceptReplay("replay/restart", "12", 128))
    instance.close()
    instance = fresh()
    assertFullConfiguration(instance)
    assertArrayEquals(byteArrayOf(31, 32, 33), instance.get("meta", "peer/restart"))
    assertEquals("1", instance.getHigh("scope/restart"))
    assertEquals("2", instance.reserveNonce("scope/restart", "1"))
    assertFalse(instance.acceptReplay("replay/restart", "12", 128))
  }

  @Test fun validProbeInspectChecksSqliteAndDoesNotFailDuringClose() {
    val report = ProbeReport.inspect(context, name, alias)
    assertNotEquals("PROBE_FAILED_CLOSED", report.getString("classification"))
    val sqlite = report.getJSONObject("capabilities").getJSONObject("sqlite")
    assertEquals(2, sqlite.getInt("synchronous"))
    assertEquals(1, sqlite.getInt("secureDelete"))
    assertEquals("delete", sqlite.getString("journalMode"))
    assertTrue(sqlite.getBoolean("verifiedFullDurability"))
  }

  @Test fun failedProbeInspectPreservesActualUnderlyingException() {
    SQLiteDatabase.openOrCreateDatabase(path(), null).use { raw -> raw.version = 99 }
    val report = ProbeReport.inspect(context, name, alias)
    assertEquals("PROBE_FAILED_CLOSED", report.getString("classification"))
    val caps = report.getJSONObject("capabilities")
    assertEquals("IllegalStateException", caps.getString("failureClass"))
    assertFalse(caps.getBoolean("enabled"))
    assertFalse(report.getBoolean("productionSecurityActivated"))
    assertFalse(report.getBoolean("secretsOrKeyBytesIncluded"))
    assertFalse("Cleanup failure must not mask the underlying DB failure",
      caps.has("cleanupFailureClass"))
    SQLiteDatabase.openOrCreateDatabase(path(), null).use { raw ->
      assertEquals(99, raw.version)
    }
  }
}
