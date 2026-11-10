package com.bushmeshmain.security

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.File
import java.math.BigInteger
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/**
 * Isolated, not automatically selected Security v1 storage.
 *
 * AES-GCM protects every value (including trust metadata) under a device-local
 * AndroidKeyStore key. SQLite performs all multi-row and counter operations in
 * durable transactions. The database lives in noBackupFilesDir; it MUST NOT
 * be treated as a hardware rollback-resistant monotonic store.
 */
class BushMeshSecurityCore(
  private val context: Context,
  private val filename: String = "bushmesh_security_v1.db",
  private val masterAlias: String = "bushmesh_security_store_aes_v1",
) {
  companion object {
    private val lock = Any()
    private val maxCounter = BigInteger("18446744073709551615")
    private val maxEpoch = 2147483647
  }

  private val database: SQLiteDatabase by lazy {
    val file = File(context.noBackupFilesDir, filename)
    val db = SQLiteDatabase.openOrCreateDatabase(file, null)
    db.execSQL("PRAGMA synchronous=FULL")
    db.execSQL("PRAGMA secure_delete=ON")
    if (db.version != 0 && db.version != 1) {
      db.close()
      throw IllegalStateException("Unsupported BushMesh security storage schema")
    }
    db.beginTransaction()
    try {
      db.execSQL("CREATE TABLE IF NOT EXISTS entries (kind TEXT NOT NULL, name TEXT NOT NULL, sealed BLOB NOT NULL, PRIMARY KEY(kind, name))")
      db.execSQL("CREATE TABLE IF NOT EXISTS nonce (scope TEXT PRIMARY KEY, counter TEXT NOT NULL, high TEXT NOT NULL)")
      db.execSQL("CREATE TABLE IF NOT EXISTS replay (scope TEXT PRIMARY KEY, highest TEXT NOT NULL, bits TEXT NOT NULL, size INTEGER NOT NULL)")
      db.execSQL("CREATE TABLE IF NOT EXISTS consumed (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)")
      db.execSQL("CREATE TABLE IF NOT EXISTS epoch_high (group_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL)")
      db.execSQL("CREATE TABLE IF NOT EXISTS epoch_commit (tx_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, digest TEXT NOT NULL, epoch INTEGER NOT NULL)")
      if (db.version == 0) db.version = 1
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    db
  }

  private fun checkName(name: String) {
    require(Regex("[a-zA-Z0-9_.:/-]{1,240}").matches(name)) { "Invalid security storage identifier" }
  }

  private fun counter(value: String): BigInteger {
    require(Regex("(0|[1-9][0-9]{0,19})").matches(value)) { "Invalid unsigned nonce/replay counter" }
    val n = BigInteger(value)
    require(n >= BigInteger.ZERO && n <= maxCounter) { "Counter outside unsigned 64-bit range" }
    return n
  }

  private fun ks(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun hardwareLevel(key: SecretKey): String {
    val factory = SecretKeyFactory.getInstance(key.algorithm, "AndroidKeyStore")
    val info = factory.getKeySpec(key, KeyInfo::class.java) as KeyInfo
    return if (Build.VERSION.SDK_INT >= 31) {
      when (info.securityLevel) {
        KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
        KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
        else -> "unsupported"
      }
    } else if (info.isInsideSecureHardware) {
      "hardware-unclassified"
    } else {
      "unsupported"
    }
  }

  fun storageSecurityLevel(): String = synchronized(lock) {
    hardwareLevel(wrappingKey())
  }

  private fun wrappingKey(): SecretKey {
    val keyStore = ks()
    val stored = keyStore.getKey(masterAlias, null)
    if (stored != null) {
      val key = stored as? SecretKey ?: throw IllegalStateException("Storage alias has wrong key type")
      require(hardwareLevel(key) != "unsupported") { "Software-only storage protection is disabled" }
      return key
    }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    val spec = KeyGenParameterSpec.Builder(
      masterAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    ).setKeySize(256)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true)
      .build()
    generator.init(spec)
    val key = generator.generateKey()
    require(hardwareLevel(key) != "unsupported") {
      // Do not retain a software key under an apparently protected alias.
      keyStore.deleteEntry(masterAlias)
      "Hardware-backed AndroidKeyStore AES-GCM is required"
    }
    return key
  }

  private fun aad(kind: String, name: String): ByteArray =
    ("bushmesh-security-store-v1:" + kind + ":" + name).toByteArray(StandardCharsets.UTF_8)

  private fun seal(kind: String, name: String, value: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
    cipher.updateAAD(aad(kind, name))
    val body = cipher.doFinal(value)
    return byteArrayOf(1) + cipher.iv + body
  }

  private fun open(kind: String, name: String, sealed: ByteArray): ByteArray {
    if (sealed.size < 1 + 12 + 16 || sealed[0] != 1.toByte()) {
      throw IllegalStateException("Corrupt security storage envelope")
    }
    try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(128, sealed.copyOfRange(1, 13)))
      cipher.updateAAD(aad(kind, name))
      return cipher.doFinal(sealed.copyOfRange(13, sealed.size))
    } catch (e: AEADBadTagException) {
      throw IllegalStateException("Security storage authentication failed", e)
    }
  }

  private fun loadLocked(db: SQLiteDatabase, kind: String, name: String): ByteArray? {
    db.rawQuery("SELECT sealed FROM entries WHERE kind=? AND name=?", arrayOf(kind, name)).use {
      if (!it.moveToFirst()) return null
      return open(kind, name, it.getBlob(0))
    }
  }

  private fun putLocked(db: SQLiteDatabase, kind: String, name: String, value: ByteArray) {
    val values = ContentValues().apply {
      put("kind", kind)
      put("name", name)
      put("sealed", seal(kind, name, value))
    }
    require(db.insertWithOnConflict("entries", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1L) {
      "Security storage write failed"
    }
  }

  private inline fun <T> transaction(operation: (SQLiteDatabase) -> T): T = synchronized(lock) {
    val db = database
    db.beginTransaction()
    try {
      val result = operation(db)
      db.setTransactionSuccessful()
      result
    } finally {
      db.endTransaction()
    }
  }

  fun get(kind: String, name: String): ByteArray? = synchronized(lock) {
    require(kind == "secret" || kind == "meta")
    checkName(name)
    loadLocked(database, kind, name)
  }

  fun put(kind: String, name: String, value: ByteArray) {
    require(kind == "secret" || kind == "meta")
    checkName(name)
    // Identity fields can only be committed as a pair.
    require(kind != "meta" || (name != "identity" && name != "identityHandles"))
    require(value.size <= 256 * 1024) { "Oversized security storage value" }
    transaction { putLocked(it, kind, name, value) }
  }

  fun remove(kind: String, name: String) {
    require(kind == "secret" || kind == "meta")
    checkName(name)
    transaction { it.delete("entries", "kind=? AND name=?", arrayOf(kind, name)) }
  }

  fun listMetadata(prefix: String): List<String> = synchronized(lock) {
    checkName(prefix)
    val names = mutableListOf<String>()
    database.rawQuery("SELECT name FROM entries WHERE kind='meta' ORDER BY name", null).use {
      while (it.moveToNext()) if (it.getString(0).startsWith(prefix)) names.add(it.getString(0))
    }
    names
  }

  fun setIdentityAtomic(identityJson: String, handlesJson: String) {
    val identity = JSONObject(identityJson)
    val handles = JSONObject(handlesJson)
    val epoch = identity.getInt("keyEpoch")
    require(epoch > 0 && epoch == handles.getInt("keyEpoch")) { "Mismatched identity key epochs" }
    val sign = handles.getJSONObject("signingPrivateKey")
    val agree = handles.getJSONObject("agreementPrivateKey")
    require(sign.getString("algorithm") == "Ed25519" && sign.getString("purpose") == "identity-signing")
    require(agree.getString("algorithm") == "X25519" && agree.getString("purpose") == "identity-agreement")
    transaction {
      putLocked(it, "meta", "identity", identityJson.toByteArray(StandardCharsets.UTF_8))
      putLocked(it, "meta", "identityHandles", handlesJson.toByteArray(StandardCharsets.UTF_8))
    }
  }

  fun getHigh(scope: String): String = synchronized(lock) {
    checkName(scope)
    database.rawQuery("SELECT high FROM nonce WHERE scope=?", arrayOf(scope)).use {
      if (it.moveToFirst()) it.getString(0) else "0"
    }
  }

  /** Counter and high water are committed TOGETHER, before a nonce is issued. */
  fun reserveNonce(scope: String, minimum: String): String {
    checkName(scope)
    val floor = counter(minimum)
    return transaction { db ->
      var persisted = BigInteger.ZERO
      db.rawQuery("SELECT counter, high FROM nonce WHERE scope=?", arrayOf(scope)).use {
        if (it.moveToFirst()) persisted = counter(it.getString(0)).max(counter(it.getString(1)))
      }
      val next = persisted.max(floor).add(BigInteger.ONE)
      require(next <= maxCounter) { "Nonce exhausted" }
      db.execSQL(
        "INSERT OR REPLACE INTO nonce(scope,counter,high) VALUES (?,?,?)",
        arrayOf(scope, next.toString(), next.toString()),
      )
      next.toString()
    }
  }

  fun advanceHigh(scope: String, value: String) {
    checkName(scope)
    val proposed = counter(value)
    transaction { db ->
      var current = BigInteger.ZERO
      db.rawQuery("SELECT high FROM nonce WHERE scope=?", arrayOf(scope)).use {
        if (it.moveToFirst()) current = counter(it.getString(0))
      }
      val greatest = proposed.max(current)
      db.execSQL(
        "INSERT OR REPLACE INTO nonce(scope,counter,high) VALUES (?,?,?)",
        arrayOf(scope, greatest.toString(), greatest.toString()),
      )
    }
  }

  fun acceptReplay(scope: String, value: String, window: Int): Boolean {
    checkName(scope)
    require(window in 8..1024)
    val incoming = counter(value)
    if (incoming == BigInteger.ZERO) return false
    return transaction { db ->
      var highest = BigInteger.ZERO
      var bits = BigInteger.ZERO
      db.rawQuery("SELECT highest,bits,size FROM replay WHERE scope=?", arrayOf(scope)).use {
        if (it.moveToFirst()) {
          highest = counter(it.getString(0))
          bits = BigInteger(it.getString(1), 16)
          require(it.getInt(2) == window) { "Replay window size changed for existing scope" }
        }
      }
      val accepted: Boolean
      if (incoming > highest) {
        val jump = incoming.subtract(highest)
        bits = if (jump >= BigInteger.valueOf(window.toLong())) BigInteger.ONE
          else bits.shiftLeft(jump.toInt()).or(BigInteger.ONE)
        highest = incoming
        accepted = true
      } else {
        val distance = highest.subtract(incoming)
        accepted = distance < BigInteger.valueOf(window.toLong()) && !bits.testBit(distance.toInt())
        if (accepted) bits = bits.setBit(distance.toInt())
      }
      if (accepted) {
        bits = bits.and(BigInteger.ONE.shiftLeft(window).subtract(BigInteger.ONE))
        db.execSQL(
          "INSERT OR REPLACE INTO replay(scope,highest,bits,size) VALUES(?,?,?,?)",
          arrayOf(scope, highest.toString(), bits.toString(16), window),
        )
      }
      accepted
    }
  }

  /** IDs cannot be re-used after expiry; expiry is for protocol policy, not GC. */
  fun consumeHandshake(id: String, expiresAt: Long): Boolean {
    checkName(id)
    require(expiresAt > System.currentTimeMillis()) { "Expired handshake" }
    return transaction { db ->
      val values = ContentValues().apply { put("id", id); put("expires", expiresAt) }
      db.insertWithOnConflict("consumed", null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }
  }

  /**
   * Storage-only V2 primitive. NO membership, issuer, roster or signing
   * authorization is inferred by this method. The future Security v2 service
   * must authenticate and validate its complete commit before calling.
   */
  fun commitEpoch(
    txId: String, groupId: String, digest: String, expected: Int, next: Int,
    groupJson: String, keyRef: String, secret: ByteArray,
  ): Boolean {
    listOf(txId, groupId, digest, keyRef).forEach(::checkName)
    require(expected >= 0 && expected < maxEpoch && next == expected + 1)
    require(secret.size == 32) { "A group epoch key must contain exactly 32 bytes" }
    val record = JSONObject(groupJson)
    require(record.getString("groupId") == groupId && record.getInt("currentEpoch") == next)
    return transaction { db ->
      db.rawQuery("SELECT group_id,digest,epoch FROM epoch_commit WHERE tx_id=?", arrayOf(txId)).use {
        if (it.moveToFirst()) {
          if (it.getString(0) != groupId || it.getString(1) != digest || it.getInt(2) != next) {
            throw IllegalStateException("Conflicting security transaction ID")
          }
          return@transaction false // Identical transaction was committed previously.
        }
      }
      var previous = 0
      db.rawQuery("SELECT epoch FROM epoch_high WHERE group_id=?", arrayOf(groupId)).use {
        if (it.moveToFirst()) previous = it.getInt(0)
      }
      require(previous == expected) { "Stale or rolled-back group epoch" }
      require(loadLocked(db, "secret", keyRef) == null) { "Epoch key reference already exists" }
      putLocked(db, "secret", keyRef, secret)
      putLocked(db, "meta", "group/" + groupId, groupJson.toByteArray(StandardCharsets.UTF_8))
      db.execSQL("INSERT OR REPLACE INTO epoch_high(group_id,epoch) VALUES(?,?)", arrayOf(groupId, next))
      db.execSQL(
        "INSERT INTO epoch_commit(tx_id,group_id,digest,epoch) VALUES (?,?,?,?)",
        arrayOf(txId, groupId, digest, next),
      )
      true
    }
  }

  fun epochHigh(groupId: String): Int = synchronized(lock) {
    checkName(groupId)
    database.rawQuery("SELECT epoch FROM epoch_high WHERE group_id=?", arrayOf(groupId)).use {
      if (it.moveToFirst()) it.getInt(0) else 0
    }
  }

  fun close() = synchronized(lock) { if (database.isOpen) database.close() }

  fun base64(value: ByteArray): String = Base64.encodeToString(value, Base64.NO_WRAP)
  fun unbase64(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)
}
