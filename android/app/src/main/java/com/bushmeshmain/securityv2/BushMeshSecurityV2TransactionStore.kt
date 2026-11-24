package com.bushmeshmain.securityv2

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject

/**
 * Deliberately unregistered storage-only Android V2 candidate.
 *
 * This is REAL SQLite transaction code, NOT a live Android provider: no
 * ReactPackage, no Security v1 V1 epoch casts, no application injection.
 * A reviewed native value sealer, externally approved genesis authority and
 * independent rollback witness MUST be supplied. No production implementation
 * of those three security dependencies exists in this branch.
 *
 * SQLite FULL commits make same-DB row changes crash-atomic. They do not
 * establish device hardware rollback resistance or cross-device consensus.
 */
internal interface V2ValueSealer {
  fun seal(kind: String, name: String, plaintext: ByteArray): ByteArray
  fun open(kind: String, name: String, ciphertext: ByteArray): ByteArray
}

internal interface V2AuthorityAdmission {
  /** Must verify a separately established owner approval, never TOFU. */
  fun approveOwnerPin(groupId: String, fingerprint: String, digest: String, ceremonyProof: String)
  fun assertOwnedGenesis(snapshot: JSONObject, pinned: JSONObject)
  fun assertPreparedRequest(journal: JSONObject, current: JSONObject)
  fun assertCommittedApproval(journal: JSONObject, previous: JSONObject, next: JSONObject)
  fun assertRecipientInstall(snapshot: JSONObject, digest: String, pinned: JSONObject)
  /** Signature and exact issued distribution checked OUTSIDE this store. */
  fun assertVerifiedAck(journal: JSONObject, recipient: String, digest: String)
  fun assertRoleRevocation(group: JSONObject, credentialId: String)
}

/**
 * MUST compare against an independently trusted anti-rollback witness.
 * An in-memory object or another SQLite table is NOT production evidence.
 * The only available native provider in this branch is test-only.
 */
internal interface V2IndependentEpochWitness {
  fun assertCurrent(groupId: String, sqliteEpoch: Long)
  /** External witness may enter a pending state; uncertain results fail closed. */
  fun prepare(groupId: String, previous: Long, next: Long, transactionDigest: String)
  fun complete(groupId: String, next: Long, transactionDigest: String)
}

/** Test-only deterministic fault hook; never registered in an app runtime. */
internal fun interface V2TransactionFault {
  fun at(point: String)
}

internal class BushMeshSecurityV2TransactionStore(
  context: Context,
  private val sealer: V2ValueSealer,
  private val authority: V2AuthorityAdmission,
  private val witness: V2IndependentEpochWitness,
  private val fault: V2TransactionFault = V2TransactionFault { },
  filename: String = "bushmesh_security_v2_candidate.db",
) {
  private val lock = Any()
  private val database: SQLiteDatabase by lazy {
    val file = File(context.noBackupFilesDir, filename)
    val db = SQLiteDatabase.openOrCreateDatabase(file, null)
    db.execSQL("PRAGMA synchronous=FULL")
    db.execSQL("PRAGMA secure_delete=ON")
    require(db.version in 0..2) { "UNSUPPORTED_VERSION: V2 storage schema" }
    db.beginTransaction()
    try {
      db.execSQL("CREATE TABLE IF NOT EXISTS owner_anchor (group_id TEXT PRIMARY KEY, data BLOB NOT NULL)")
      db.execSQL("CREATE TABLE IF NOT EXISTS snapshot (group_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, roster_digest TEXT NOT NULL, authority_seq INTEGER NOT NULL, state TEXT NOT NULL, current_tx TEXT, data BLOB NOT NULL)")
      db.execSQL("CREATE TABLE IF NOT EXISTS epoch_high (group_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL)")
      db.execSQL("CREATE TABLE IF NOT EXISTS epoch_key (group_id TEXT NOT NULL, epoch INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(group_id,epoch))")
      db.execSQL("CREATE TABLE IF NOT EXISTS journal (tx_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, request_id TEXT NOT NULL, proposal_digest TEXT NOT NULL, expected_epoch INTEGER NOT NULL, next_epoch INTEGER NOT NULL, before_digest TEXT NOT NULL, after_digest TEXT NOT NULL, state TEXT NOT NULL, data BLOB NOT NULL, UNIQUE(group_id,request_id))")
      db.execSQL("CREATE TABLE IF NOT EXISTS issued (tx_id TEXT NOT NULL, recipient TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(tx_id,recipient,digest))")
      db.execSQL("CREATE TABLE IF NOT EXISTS installed (tx_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, epoch INTEGER NOT NULL, digest TEXT NOT NULL)")
      db.execSQL("CREATE TABLE IF NOT EXISTS receipts (tx_id TEXT NOT NULL, recipient TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(tx_id,recipient))")
      if (db.version == 0) db.version = 2
      require(db.version == 2) { "UNSUPPORTED_VERSION: V2 schema mismatch" }
      db.setTransactionSuccessful()
    } finally {
      db.endTransaction()
    }
    db
  }

  private fun <T> transaction(block: (SQLiteDatabase) -> T): T = synchronized(lock) {
    val db = database
    db.beginTransaction()
    try {
      val result = block(db)
      db.setTransactionSuccessful()
      result
    } finally {
      db.endTransaction()
    }
  }

  private fun text(json: JSONObject, name: String): String =
    json.getString(name).also(SecurityV2NativeRules::id)

  private fun sealed(kind: String, name: String, text: String): ByteArray {
    val bytes = text.toByteArray(StandardCharsets.UTF_8)
    require(bytes.size <= 256 * 1024) { "INVALID_INPUT: oversized V2 record" }
    return try { sealer.seal(kind, name, bytes) } finally { bytes.fill(0) }
  }

  private fun unseal(kind: String, name: String, bytes: ByteArray): String {
    val plaintext = sealer.open(kind, name, bytes)
    return try {
      String(plaintext, StandardCharsets.UTF_8)
    } finally { plaintext.fill(0) }
  }

  private fun lookup(db: SQLiteDatabase, table: String, where: String,
    args: Array<String>, column: String): ByteArray? {
    db.query(table, arrayOf(column), where, args, null, null, null).use {
      return if (it.moveToFirst()) it.getBlob(0) else null
    }
  }

  private fun snapshot(db: SQLiteDatabase, groupId: String): JSONObject? {
    val raw = lookup(db,"snapshot","group_id=?",arrayOf(groupId),"data") ?: return null
    val record = JSONObject(unseal("snapshot", groupId, raw))
    require(record.getInt("version") == 2 && record.getString("groupId") == groupId) {
      "CORRUPT_STATE: invalid sealed V2 snapshot"
    }
    return record
  }

  private fun anchor(db: SQLiteDatabase, groupId: String): JSONObject? {
    val raw = lookup(db,"owner_anchor","group_id=?",arrayOf(groupId),"data") ?: return null
    return JSONObject(unseal("anchor", groupId, raw))
  }

  private fun high(db: SQLiteDatabase, groupId: String): Long {
    db.rawQuery("SELECT epoch FROM epoch_high WHERE group_id=?", arrayOf(groupId)).use {
      return if (it.moveToFirst()) it.getLong(0) else 0L
    }
  }

  private fun assertCurrent(db: SQLiteDatabase, groupId: String): JSONObject? {
    val value = snapshot(db,groupId)
    val high = high(db,groupId)
    if (value == null) require(high == 0L) { "CORRUPT_STATE: orphan epoch high-water" }
    else require(value.getLong("epoch") == high) {
      "CORRUPT_STATE: V2 snapshot/high-water divergence"
    }
    witness.assertCurrent(groupId,high)
    return value
  }

  private fun journal(db: SQLiteDatabase, txId: String): JSONObject? {
    val sealed = lookup(db,"journal","tx_id=?",arrayOf(txId),"data") ?: return null
    val value = JSONObject(unseal("journal",txId,sealed))
    db.rawQuery("SELECT state FROM journal WHERE tx_id=?",arrayOf(txId)).use {
      require(it.moveToFirst()) { "CORRUPT_STATE: missing V2 journal row" }
      value.put("status",it.getString(0))
    }
    val issued = JSONObject()
    db.rawQuery("SELECT recipient,digest FROM issued WHERE tx_id=? ORDER BY recipient,digest",
      arrayOf(txId)).use {
      while (it.moveToNext()) {
        val recipient = it.getString(0)
        val array = issued.optJSONArray(recipient) ?: JSONArray().also { a ->
          issued.put(recipient,a)
        }
        array.put(it.getString(1))
      }
    }
    value.put("issuedDistributions",issued)
    val receipts = JSONObject()
    db.rawQuery("SELECT recipient,digest FROM receipts WHERE tx_id=?",
      arrayOf(txId)).use {
      while (it.moveToNext()) receipts.put(it.getString(0),it.getString(1))
    }
    value.put("verifiedReceipts",receipts)
    return value
  }

  private fun insertJson(db: SQLiteDatabase, table: String, idColumn: String,
    id: String, kind: String, value: JSONObject): Long {
    return db.insertWithOnConflict(table,null,ContentValues().apply {
      put(idColumn,id)
      put("data",sealed(kind,id,value.toString()))
    },SQLiteDatabase.CONFLICT_ABORT)
  }

  private fun putSnapshot(db: SQLiteDatabase, value: JSONObject) {
    val groupId = text(value,"groupId")
    val epoch = value.getLong("epoch")
    SecurityV2NativeRules.epoch(epoch)
    val digest = text(value,"rosterDigest")
    SecurityV2NativeRules.digest(digest)
    db.insertWithOnConflict("snapshot",null,ContentValues().apply {
      put("group_id",groupId)
      put("epoch",epoch)
      put("roster_digest",digest)
      put("authority_seq",value.getLong("authoritySequence"))
      put("state",value.getString("state"))
      put("current_tx",value.optString("currentTransactionId").ifEmpty { null as String? })
      put("data",sealed("snapshot",groupId,value.toString()))
    },SQLiteDatabase.CONFLICT_REPLACE)
  }

  private fun putKey(db: SQLiteDatabase, groupId: String, epoch: Long, key: ByteArray) {
    SecurityV2NativeRules.key(key)
    db.insertWithOnConflict("epoch_key",null,ContentValues().apply {
      put("group_id",groupId)
      put("epoch",epoch)
      put("data",sealer.seal("epoch-key","$groupId/$epoch",key))
    },SQLiteDatabase.CONFLICT_ABORT)
  }

  private fun getKey(db: SQLiteDatabase, groupId: String, epoch: Long): ByteArray? {
    val sealed = lookup(db,"epoch_key","group_id=? AND epoch=?",
      arrayOf(groupId,epoch.toString()),"data") ?: return null
    return sealer.open("epoch-key","$groupId/$epoch",sealed).also {
      SecurityV2NativeRules.key(it)
    }
  }

  private fun members(value: JSONObject): List<SecurityV2NativeRules.Member> {
    val roster = value.getJSONArray("roster")
    require(roster.length() in 1..256) { "CORRUPT_STATE: invalid V2 roster count" }
    return (0 until roster.length()).map { index ->
      val m = roster.getJSONObject(index)
      SecurityV2NativeRules.Member(
        deviceId = text(m,"deviceId"),
        fingerprint = text(m,"fingerprint"),
        keyEpoch = m.getLong("keyEpoch"),
        state = m.getString("state"),
        joinedAt = m.getLong("joinedAt"),
        revokedAt = if (m.has("revokedAt")) m.getLong("revokedAt") else null,
      )
    }
  }

  private fun revocations(value: JSONObject): Set<String> {
    val list = value.getJSONArray("revokedCredentials")
    return (0 until list.length()).map { list.getString(it) }.toSet()
  }

  /** Does NOT authenticate proof alone: injected authority MUST validate ceremony. */
  fun provisionApprovedOwnerAnchor(groupId: String, fingerprint: String,
    genesisDigest: String, ceremonyProof: String): String = transaction { db ->
    SecurityV2NativeRules.groupId(groupId)
    SecurityV2NativeRules.digest(genesisDigest)
    SecurityV2NativeRules.id(fingerprint)
    require(ceremonyProof.isNotBlank()) { "FORGED_AUTHORITY: no independent owner proof" }
    authority.approveOwnerPin(groupId,fingerprint,genesisDigest,ceremonyProof)
    val next = JSONObject().put("groupId",groupId)
      .put("ownerFingerprint",fingerprint).put("genesisDigest",genesisDigest)
    val old = anchor(db,groupId)
    if (old != null) {
      require(old.toString() == next.toString()) { "CONFLICT: owner anchor immutable" }
      return@transaction "already-pinned-identical"
    }
    require(snapshot(db,groupId) == null) { "CONFLICT: group already created" }
    insertJson(db,"owner_anchor","group_id",groupId,"anchor",next)
    "pinned"
  }

  fun readOwnerAnchor(groupId: String): String? = synchronized(lock) {
    SecurityV2NativeRules.groupId(groupId)
    anchor(database,groupId)?.toString()
  }

  fun readGroup(groupId: String): String? = synchronized(lock) {
    SecurityV2NativeRules.groupId(groupId)
    assertCurrent(database,groupId)?.toString()
  }

  fun readEpochFence(groupId: String): Long = synchronized(lock) {
    SecurityV2NativeRules.groupId(groupId)
    assertCurrent(database,groupId)
    high(database,groupId)
  }

  fun readEpochSecret(groupId: String, epoch: Long): ByteArray? = synchronized(lock) {
    SecurityV2NativeRules.groupId(groupId)
    SecurityV2NativeRules.epoch(epoch)
    val current = assertCurrent(database,groupId) ?: return@synchronized null
    if (current.getLong("epoch") != epoch || current.getString("state") != "active") {
      return@synchronized null
    }
    getKey(database,groupId,epoch)
  }

  fun readPreparedTransaction(txId: String): String? = synchronized(lock) {
    SecurityV2NativeRules.id(txId)
    val tx = journal(database,txId) ?: return@synchronized null
    assertCurrent(database,tx.getJSONObject("approval").getJSONObject("proposal").getString("groupId"))
    tx.toString()
  }

  fun readInstalledDistribution(txId: String): String? = synchronized(lock) {
    SecurityV2NativeRules.id(txId)
    database.rawQuery("SELECT digest FROM installed WHERE tx_id=?",arrayOf(txId)).use {
      if (it.moveToFirst()) it.getString(0) else null
    }
  }

  fun readVerifiedReceipt(txId: String, recipient: String): String? = synchronized(lock) {
    SecurityV2NativeRules.id(txId)
    SecurityV2NativeRules.id(recipient)
    database.rawQuery("SELECT digest FROM receipts WHERE tx_id=? AND recipient=?",
      arrayOf(txId,recipient)).use {
      if (it.moveToFirst()) it.getString(0) else null
    }
  }

  fun atomicCreateOwnerGroup(snapshot: JSONObject, pin: JSONObject, key: ByteArray): String {
    val groupId = text(snapshot,"groupId")
    val digest = text(snapshot,"genesisDigest")
    SecurityV2NativeRules.digest(digest)
    SecurityV2NativeRules.key(key)
    require(snapshot.getInt("version") == 2 && snapshot.getLong("epoch") == 1L &&
      snapshot.isNull("currentTransactionId") &&
      snapshot.getString("state") == "active") { "INVALID_INPUT: invalid owner genesis" }
    val result = transaction { db ->
      val pinned = anchor(db,groupId)
        ?: throw IllegalStateException("UNTRUSTED: owner ceremony was not performed")
      require(pinned.toString() == pin.toString() &&
        pinned.getString("genesisDigest") == digest &&
        pinned.getString("ownerFingerprint") ==
          snapshot.getJSONObject("genesis").getJSONObject("owner").getString("fingerprint")) {
        "FORGED_AUTHORITY: owner pin mismatch"
      }
      authority.assertOwnedGenesis(snapshot,pinned)
      require(assertCurrent(db,groupId) == null) { "CONFLICT: genesis already initialized" }
      witness.prepare(groupId,0L,1L,digest)
      fault.at("before-genesis-commit")
      putSnapshot(db,snapshot)
      putKey(db,groupId,1L,key)
      db.insertWithOnConflict("epoch_high",null,ContentValues().apply {
        put("group_id",groupId);put("epoch",1L)
      },SQLiteDatabase.CONFLICT_ABORT)
      "created"
    }
    witness.complete(groupId,1L,digest)
    return result
  }

  fun atomicPrepareAddition(expected: Long, beforeDigest: String,
    record: JSONObject): String = transaction { db ->
    SecurityV2NativeRules.epoch(expected)
    SecurityV2NativeRules.digest(beforeDigest)
    val txId = text(record,"transactionId")
    val request = text(record,"requestId")
    val proposalDigest = text(record,"proposalDigest")
    SecurityV2NativeRules.digest(proposalDigest)
    val proposal = record.getJSONObject("approval").getJSONObject("proposal")
    val groupId = text(proposal,"groupId")
    val group = assertCurrent(db,groupId)
      ?: throw IllegalStateException("NOT_COMMITTED: missing V2 genesis")
    require(group.getString("state") == "active" &&
      group.getLong("epoch") == expected &&
      group.getString("rosterDigest") == beforeDigest &&
      record.getLong("expectedEpoch") == expected &&
      record.getLong("nextEpoch") == expected + 1L &&
      record.getString("status") == "prepared" &&
      proposal.getString("transactionId") == txId &&
      proposal.getString("requestId") == request &&
      proposal.getString("rosterDigestBefore") == beforeDigest &&
      proposal.getString("rosterDigestAfter") == record.getString("nextRosterDigest")) {
      "STALE_EPOCH: prepared request does not match current roster"
    }
    authority.assertPreparedRequest(record,group)
    val earlier = journal(db,txId)
    if (earlier != null) {
      require(earlier.getString("proposalDigest") == proposalDigest &&
        earlier.getString("requestId") == request &&
        earlier.getLong("expectedEpoch") == expected &&
        earlier.getString("nextRosterDigest") == record.getString("nextRosterDigest")) {
        "CONFLICT: transaction ID reused with different digest"
      }
      return@transaction earlier.toString()
    }
    val existingRequest = db.rawQuery("SELECT tx_id FROM journal WHERE group_id=? AND request_id=?",
      arrayOf(groupId,request)).use { it.moveToFirst() }
    require(!existingRequest) { "REPLAY: signed request ID already consumed" }
    fault.at("before-prepare-commit")
    db.insertWithOnConflict("journal",null,ContentValues().apply {
      put("tx_id",txId);put("group_id",groupId);put("request_id",request)
      put("proposal_digest",proposalDigest)
      put("expected_epoch",expected);put("next_epoch",expected+1L)
      put("before_digest",beforeDigest)
      put("after_digest",record.getString("nextRosterDigest"))
      put("state","prepared")
      put("data",sealed("journal",txId,record.toString()))
    },SQLiteDatabase.CONFLICT_ABORT)
    journal(db,txId)!!.toString()
  }

  fun atomicCommitAddition(txId: String, next: JSONObject, newKey: ByteArray): String {
    SecurityV2NativeRules.id(txId)
    SecurityV2NativeRules.key(newKey)
    val groupId = text(next,"groupId")
    val digest = text(next,"rosterDigest")
    SecurityV2NativeRules.digest(digest)
    val result = transaction { db ->
      val prepared = journal(db,txId)
        ?: throw IllegalStateException("NOT_COMMITTED: no prepared journal")
      val current = assertCurrent(db,groupId)
        ?: throw IllegalStateException("NOT_COMMITTED: no group")
      if (prepared.getString("status") == "committed") {
        require(current.getString("currentTransactionId") == txId &&
          current.getLong("epoch") == prepared.getLong("nextEpoch") &&
          current.getString("rosterDigest") == digest) {
          "STALE_EPOCH: committed transaction superseded"
        }
        return@transaction "already-committed-identical"
      }
      require(prepared.getString("status") == "prepared" &&
        prepared.getJSONObject("approval").getJSONObject("proposal").getString("groupId") == groupId &&
        current.getString("state") == "active" &&
        current.getLong("epoch") == prepared.getLong("expectedEpoch") &&
        current.getString("rosterDigest") ==
          prepared.getJSONObject("approval").getJSONObject("proposal").getString("rosterDigestBefore") &&
        next.getLong("epoch") == prepared.getLong("nextEpoch") &&
        next.getString("currentTransactionId") == txId &&
        digest == prepared.getString("nextRosterDigest") &&
        next.getString("genesisDigest") == current.getString("genesisDigest") &&
        next.getLong("authoritySequence") == current.getLong("authoritySequence") &&
        next.getString("state") == "active" &&
        revocations(next) == revocations(current)) {
        "STALE_EPOCH: atomic roster/authority CAS conflict"
      }
      SecurityV2NativeRules.advance(current.getLong("epoch"),next.getLong("epoch"))
      val requester = prepared.getJSONObject("join").getJSONObject("requester").getString("deviceId")
      require(SecurityV2NativeRules.members(members(current),members(next),requester)) {
        "CONFLICT: commit changed an existing member or fabricated roster"
      }
      authority.assertCommittedApproval(prepared,current,next)
      val previousKey = getKey(db,groupId,current.getLong("epoch"))
        ?: throw IllegalStateException("KEY_MISSING: missing old protected key")
      try {
        require(SecurityV2NativeRules.distinctKey(previousKey,newKey)) {
          "KEY_MISSING: old epoch key reused"
        }
      } finally { previousKey.fill(0) }
      witness.prepare(groupId,current.getLong("epoch"),next.getLong("epoch"),digest)
      fault.at("before-commit")
      db.delete("epoch_key","group_id=? AND epoch=?",
        arrayOf(groupId,current.getLong("epoch").toString()))
      putKey(db,groupId,next.getLong("epoch"),newKey)
      putSnapshot(db,next)
      db.execSQL("UPDATE epoch_high SET epoch=? WHERE group_id=?",
        arrayOf(next.getLong("epoch"),groupId))
      db.execSQL("UPDATE journal SET state='committed' WHERE tx_id=?",arrayOf(txId))
      "committed"
    }
    fault.at("after-commit") // May throw after the SQLite commit; retry must read journal.
    if (result == "committed") witness.complete(groupId,next.getLong("epoch"),digest)
    return result
  }

  fun recordIssuedDistribution(txId: String, recipient: String, digest: String): String =
    transaction { db ->
      SecurityV2NativeRules.id(txId);SecurityV2NativeRules.id(recipient)
      SecurityV2NativeRules.digest(digest)
      val prepared = journal(db,txId)
        ?: throw IllegalStateException("NOT_COMMITTED: missing transaction")
      val groupId = prepared.getJSONObject("approval").getJSONObject("proposal").getString("groupId")
      val current = assertCurrent(db,groupId)
        ?: throw IllegalStateException("NOT_COMMITTED: missing committed group")
      require(prepared.getString("status") == "committed" &&
        current.getString("currentTransactionId") == txId &&
        members(current).any { it.deviceId == recipient && it.state != "revoked" }) {
        "STALE_EPOCH: issuance must match current protected roster"
      }
      db.insertWithOnConflict("issued",null,ContentValues().apply {
        put("tx_id",txId);put("recipient",recipient);put("digest",digest)
      },SQLiteDatabase.CONFLICT_IGNORE)
      "recorded"
    }

  fun atomicInstallEpoch(txId: String, digest: String, next: JSONObject,
    freshKey: ByteArray): String {
    SecurityV2NativeRules.id(txId)
    SecurityV2NativeRules.digest(digest)
    SecurityV2NativeRules.key(freshKey)
    val groupId = text(next,"groupId")
    val result = transaction { db ->
      val existing = db.rawQuery("SELECT group_id,epoch,digest FROM installed WHERE tx_id=?",
        arrayOf(txId)).use {
        if (it.moveToFirst()) Triple(it.getString(0),it.getLong(1),it.getString(2)) else null
      }
      if (existing != null) {
        require(existing.first == groupId && existing.second == next.getLong("epoch") &&
          existing.third == digest) { "REPLAY: conflicting recipient install" }
        return@transaction "already-installed-identical"
      }
      val pin = anchor(db,groupId)
        ?: throw IllegalStateException("UNTRUSTED: no independently pinned owner genesis")
      require(pin.getString("genesisDigest") == next.getString("genesisDigest") &&
        pin.getString("ownerFingerprint") ==
          next.getJSONObject("genesis").getJSONObject("owner").getString("fingerprint")) {
        "UNTRUSTED: recipient owner anchor mismatch"
      }
      val old = assertCurrent(db,groupId)
      val oldEpoch = old?.getLong("epoch") ?: 0L
      SecurityV2NativeRules.epoch(next.getLong("epoch"))
      require(next.getLong("epoch") > oldEpoch &&
        next.getString("state") == "active" &&
        next.getString("currentTransactionId") == txId &&
        (old == null || (
          old.getString("genesisDigest") == next.getString("genesisDigest") &&
          SecurityV2NativeRules.recipientTransition(
            members(old),members(next),revocations(old),revocations(next),
            old.getLong("authoritySequence"),next.getLong("authoritySequence")
          )
        ))) {
        "STALE_EPOCH: install would roll back group or revive revoked member"
      }
      authority.assertRecipientInstall(next,digest,pin)
      val previousKey = if (old != null) getKey(db,groupId,oldEpoch) else null
      if (previousKey != null) try {
        require(SecurityV2NativeRules.distinctKey(previousKey,freshKey)) {
          "KEY_MISSING: recipient reused previous epoch key"
        }
      } finally { previousKey.fill(0) }
      val nextEpoch = next.getLong("epoch")
      witness.prepare(groupId,oldEpoch,nextEpoch,digest)
      fault.at("before-install")
      db.delete("epoch_key","group_id=?",arrayOf(groupId))
      putKey(db,groupId,nextEpoch,freshKey)
      putSnapshot(db,next)
      db.insertWithOnConflict("epoch_high",null,ContentValues().apply {
        put("group_id",groupId);put("epoch",nextEpoch)
      },SQLiteDatabase.CONFLICT_REPLACE)
      db.insertWithOnConflict("installed",null,ContentValues().apply {
        put("tx_id",txId);put("group_id",groupId)
        put("epoch",nextEpoch);put("digest",digest)
      },SQLiteDatabase.CONFLICT_ABORT)
      "installed"
    }
    fault.at("after-install")
    if (result == "installed") witness.complete(groupId,next.getLong("epoch"),digest)
    return result
  }

  fun atomicVerifiedReceipt(txId: String, recipient: String, signedAckDigest: String): String =
    transaction { db ->
      SecurityV2NativeRules.id(txId);SecurityV2NativeRules.id(recipient)
      SecurityV2NativeRules.digest(signedAckDigest)
      val prepared = journal(db,txId)
        ?: throw IllegalStateException("NOT_COMMITTED: missing transaction")
      val groupId = prepared.getJSONObject("approval").getJSONObject("proposal").getString("groupId")
      val group = assertCurrent(db,groupId)
        ?: throw IllegalStateException("NOT_COMMITTED: missing group")
      require(prepared.getString("status") == "committed" &&
        group.getString("currentTransactionId") == txId &&
        members(group).any { it.deviceId == recipient && it.state != "revoked" }) {
        "STALE_EPOCH: signed ack cannot refer to superseded member"
      }
      authority.assertVerifiedAck(prepared,recipient,signedAckDigest)
      val count = db.rawQuery("SELECT COUNT(*) FROM issued WHERE tx_id=? AND recipient=?",
        arrayOf(txId,recipient)).use { it.moveToFirst();it.getLong(0) }
      require(count > 0L) { "NOT_INSTALLED: no issued signed envelope" }
      val existing = db.rawQuery("SELECT digest FROM receipts WHERE tx_id=? AND recipient=?",
        arrayOf(txId,recipient)).use { if (it.moveToFirst()) it.getString(0) else null }
      if (existing != null) {
        require(existing == signedAckDigest) { "REPLAY: conflicting signed ack" }
        return@transaction "already-verified-identical"
      }
      fault.at("before-ack-commit")
      db.insertWithOnConflict("receipts",null,ContentValues().apply {
        put("tx_id",txId);put("recipient",recipient);put("digest",signedAckDigest)
      },SQLiteDatabase.CONFLICT_ABORT)
      "verified"
    }

  fun atomicInvalidateEpoch(groupId: String, expected: Long): String =
    transaction { db ->
      SecurityV2NativeRules.groupId(groupId)
      val current = assertCurrent(db,groupId)
        ?: throw IllegalStateException("NOT_COMMITTED: no group")
      require(current.getLong("epoch") == expected && current.getString("state") == "active") {
        "STALE_EPOCH: invalidation CAS rejected"
      }
      // Authority must independently authorize this destructive operation.
      authority.assertRoleRevocation(current,"__invalidate_epoch__")
      current.put("state","invalidated")
      putSnapshot(db,current)
      db.delete("epoch_key","group_id=?",arrayOf(groupId))
      "invalidated"
    }

  fun atomicRevokeCredential(groupId: String, expectedSequence: Long,
    credentialId: String): String = transaction { db ->
    SecurityV2NativeRules.groupId(groupId)
    SecurityV2NativeRules.id(credentialId)
    val current = assertCurrent(db,groupId)
      ?: throw IllegalStateException("NOT_COMMITTED: no group")
    require(current.getString("state") == "active" &&
      current.getLong("authoritySequence") == expectedSequence &&
      !revocations(current).contains(credentialId)) {
      "CONFLICT: stale authority sequence or already revoked credential"
    }
    authority.assertRoleRevocation(current,credentialId)
    current.put("authoritySequence",expectedSequence+1L)
    current.getJSONArray("revokedCredentials").put(credentialId)
    putSnapshot(db,current)
    db.execSQL("UPDATE journal SET state='superseded' WHERE group_id=? AND state='prepared'",
      arrayOf(groupId))
    "revoked"
  }

  /** Caller must only attempt recovery from an independently authenticated journal. */
  fun recoverEpochWitness(groupId: String, txId: String, digest: String): String =
    synchronized(lock) {
      SecurityV2NativeRules.groupId(groupId);SecurityV2NativeRules.id(txId)
      SecurityV2NativeRules.digest(digest)
      val db = database
      val current = snapshot(db,groupId)
        ?: throw IllegalStateException("NOT_COMMITTED: cannot recover absent group")
      val high = high(db,groupId)
      require(current.getLong("epoch") == high && current.getString("rosterDigest") == digest &&
        current.getString("currentTransactionId") == txId) {
        "CORRUPT_STATE: recovery journal/epoch mismatch"
      }
      val tx = journal(db,txId)
        ?: throw IllegalStateException("CORRUPT_STATE: missing committed journal")
      require(tx.getString("status") == "committed" &&
        tx.getString("nextRosterDigest") == digest) {
        "CORRUPT_STATE: unsigned or incomplete recovery transaction"
      }
      // Independent witness MUST itself reject untrusted or rewound evidence.
      witness.complete(groupId,high,digest)
      witness.assertCurrent(groupId,high)
      "reconciled-local-commit"
    }

  fun close() = synchronized(lock) { if (database.isOpen) database.close() }
}
