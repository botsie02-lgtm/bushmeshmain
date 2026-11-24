package com.bushmeshmain.securityv2

import android.content.Context
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry

/**
 * ANDROID INSTRUMENTATION ONLY (not executed in hosted CI).
 * Uses explicitly INSECURE TEST CIPHER + FAKE independent witness to exercise
 * real SQLite crash boundaries. This cannot qualify hardware anti-rollback,
 * Keystore residency, trusted owner approval or a production secure store.
 */
@RunWith(AndroidJUnit4::class)
class BushMeshV2TransactionSqliteTest {
  private lateinit var context: Context
  private val groupId = "bmg1_native-test"
  private val d0 = "A".repeat(43)
  private val d1 = "B".repeat(43)
  private val proposalDigest = "C".repeat(43)
  private val issued = "D".repeat(43)
  private val ack = "E".repeat(43)
  private var filename = ""
  private val signer = object : V2ValueSealer {
    override fun seal(kind: String, name: String, plaintext: ByteArray): ByteArray =
      plaintext.map { (it.toInt() xor 0x5a).toByte() }.toByteArray()
    override fun open(kind: String, name: String, ciphertext: ByteArray): ByteArray =
      ciphertext.map { (it.toInt() xor 0x5a).toByte() }.toByteArray()
  }
  private val authority = object : V2AuthorityAdmission {
    override fun approveOwnerPin(groupId: String, fingerprint: String,
      digest: String, ceremonyProof: String) {
      require(ceremonyProof == "out-of-band-test-only") { "UNTRUSTED: no trusted owner ceremony" }
    }
    override fun assertOwnedGenesis(snapshot: JSONObject, pinned: JSONObject) {
      require(snapshot.getString("genesisDigest") == pinned.getString("genesisDigest"))
    }
    override fun assertPreparedRequest(journal: JSONObject, current: JSONObject) {
      require(journal.getString("proposalDigest") == proposalDigest)
    }
    override fun assertCommittedApproval(journal: JSONObject, previous: JSONObject,
      next: JSONObject) {
      require(journal.getString("proposalDigest") == proposalDigest)
    }
    override fun assertRecipientInstall(snapshot: JSONObject, digest: String,
      pinned: JSONObject) {
      require(digest == issued && snapshot.getString("genesisDigest") ==
        pinned.getString("genesisDigest"))
    }
    override fun assertVerifiedAck(journal: JSONObject, recipient: String, digest: String) {
      require(digest == ack && journal.getString("status") == "committed")
    }
    override fun assertRoleRevocation(group: JSONObject, credentialId: String) {
      require(credentialId == "admin-old" || credentialId == "__invalidate_epoch__")
    }
  }
  private class Witness : V2IndependentEpochWitness {
    val high = HashMap<String,Long>()
    val pending = HashMap<String,Triple<Long,Long,String>>()
    override fun assertCurrent(groupId: String, sqliteEpoch: Long) {
      require(!pending.containsKey(groupId)) { "CORRUPT_STATE: incomplete external epoch witness" }
      require((high[groupId] ?: 0L) == sqliteEpoch) {
        "CORRUPT_STATE: SQLite restore/epoch fence rollback"
      }
    }
    override fun prepare(groupId: String, previous: Long, next: Long,
      transactionDigest: String) {
      require(!pending.containsKey(groupId))
      require((high[groupId] ?: 0L) == previous) { "STALE_EPOCH: witness conflict" }
      pending[groupId] = Triple(previous,next,transactionDigest)
    }
    override fun complete(groupId: String, next: Long, transactionDigest: String) {
      val stage = pending[groupId]
      require(stage != null && stage.second == next && stage.third == transactionDigest) {
        "CORRUPT_STATE: external witness did not prepare"
      }
      high[groupId] = next
      pending.remove(groupId)
    }
    override fun cancelUncommitted(groupId: String, previous: Long, next: Long,
      digest: String) {
      require(pending[groupId] == Triple(previous,next,digest) &&
        (high[groupId] ?: 0L) == previous) {
        "CORRUPT_STATE: cannot cancel completed external transition"
      }
      pending.remove(groupId)
    }
  }
  private lateinit var witness: Witness
  private lateinit var store: BushMeshSecurityV2TransactionStore

  @Before fun setUp() {
    context = InstrumentationRegistry.getInstrumentation().targetContext
    filename = "security_v2_native_test_" + System.nanoTime().toString() + ".db"
    witness = Witness()
    store = BushMeshSecurityV2TransactionStore(
      context,signer,authority,witness,filename=filename,
    )
  }

  @After fun tearDown() {
    store.close()
    val f = File(context.noBackupFilesDir,filename)
    listOf(f,File(f.path+"-journal"),File(f.path+"-wal"),File(f.path+"-shm"))
      .forEach { it.delete() }
  }

  private fun pin(): JSONObject =
    JSONObject().put("groupId",groupId).put("ownerFingerprint","fp_owner")
      .put("genesisDigest",d0)

  private fun owner() = JSONObject()
    .put("deviceId","bm1_owner").put("fingerprint","fp_owner")
    .put("keyEpoch",1L).put("state","active").put("joinedAt",1000L)

  private fun requester() = JSONObject()
    .put("deviceId","bm1_joiner").put("fingerprint","fp_joiner")
    .put("keyEpoch",1L).put("state","pending-install").put("joinedAt",1100L)

  private fun snapshot(epoch: Long, rosterDigest: String, txId: String? = null): JSONObject =
    JSONObject().put("version",2).put("groupId",groupId)
      .put("convoyId","bmc1_example").put("epoch",epoch)
      .put("genesisDigest",d0).put("authoritySequence",1L)
      .put("protocolVersion",1).put("state","active")
      .put("currentTransactionId",txId ?: JSONObject.NULL)
      .put("rosterDigest",rosterDigest)
      .put("revokedCredentials",JSONArray())
      .put("genesis",JSONObject().put("owner",
        JSONObject().put("fingerprint","fp_owner")))
      .put("roster",JSONArray().put(owner()).also { if (epoch > 1L) it.put(requester()) })

  private fun journal(): JSONObject {
    val proposal = JSONObject().put("transactionId","tx1")
      .put("requestId","req1").put("groupId",groupId)
      .put("rosterDigestBefore",d0).put("rosterDigestAfter",d1)
    val credential = JSONObject().put("credentialId","credential.test")
      .put("authoritySequence",1L)
    val approval = JSONObject().put("proposal",proposal).put("credential",credential)
    val join = JSONObject().put("requester",
      JSONObject().put("deviceId","bm1_joiner").put("fingerprint","fp_joiner"))
    return JSONObject().put("transactionId","tx1").put("requestId","req1")
      .put("proposalDigest",proposalDigest).put("approval",approval)
      .put("join",join).put("expectedEpoch",1L).put("nextEpoch",2L)
      .put("nextRosterDigest",d1).put("status","prepared").put("preparedAt",1100L)
      .put("verifiedReceipts",JSONObject()).put("issuedDistributions",JSONObject())
  }

  private fun initialized() {
    store.provisionApprovedOwnerAnchor(groupId,"fp_owner",d0,"out-of-band-test-only")
    store.atomicCreateOwnerGroup(snapshot(1L,d0),pin(),ByteArray(32){1})
  }

  @Test fun testSelfSignedUnapprovedPinNeverCreatesGroup() {
    try {
      store.provisionApprovedOwnerAnchor(groupId,"fp_owner",d0,"network-self-signature")
      fail("self-signed anchor was accepted")
    } catch (_: IllegalArgumentException) {}
    try {
      store.atomicCreateOwnerGroup(snapshot(1L,d0),pin(),ByteArray(32){1})
      fail("owner genesis created without independent approval")
    } catch (_: IllegalStateException) {}
    assertNull(store.readGroup(groupId))
  }

  @Test fun testDurablePrepareCommitReceiptAndRestart() {
    initialized()
    store.atomicPrepareAddition(1L,d0,journal())
    assertEquals(1L,JSONObject(store.readGroup(groupId)).getLong("epoch"))
    assertEquals(1L,store.readEpochFence(groupId))
    assertNull(store.readVerifiedReceipt("tx1","bm1_joiner"))
    assertEquals("committed",
      store.atomicCommitAddition("tx1",snapshot(2L,d1,"tx1"),ByteArray(32){2}))
    assertNull(store.readEpochSecret(groupId,1L))
    assertEquals(32,store.readEpochSecret(groupId,2L)?.size)
    store.recordIssuedDistribution("tx1","bm1_joiner",issued)
    assertEquals("verified",store.atomicVerifiedReceipt("tx1","bm1_joiner",ack))
    assertEquals("already-verified-identical",
      store.atomicVerifiedReceipt("tx1","bm1_joiner",ack))
    store.close()
    store = BushMeshSecurityV2TransactionStore(
      context,signer,authority,witness,filename=filename,
    )
    assertEquals(2L,store.readEpochFence(groupId))
    assertEquals(ack,store.readVerifiedReceipt("tx1","bm1_joiner"))
    assertEquals("committed",JSONObject(store.readPreparedTransaction("tx1")).getString("status"))
    assertEquals("already-committed-identical",
      store.atomicCommitAddition("tx1",snapshot(2L,d1,"tx1"),ByteArray(32){3}))
    store.atomicRevokeCredential(groupId,1L,"admin-old")
    try { store.atomicRevokeCredential(groupId,1L,"admin-old")
      fail("stale role authority sequence") } catch (_: IllegalArgumentException) {}
  }

  @Test fun testInterruptedCommitBeforeAndAfterDurableSqlite() {
    initialized()
    store.atomicPrepareAddition(1L,d0,journal())
    store.close()
    var failPoint = "before-commit"
    store = BushMeshSecurityV2TransactionStore(
      context,signer,authority,witness,V2TransactionFault { p ->
        if (p == failPoint) throw IllegalStateException("Simulated power failure $p")
      },filename,
    )
    try { store.atomicCommitAddition("tx1",snapshot(2L,d1,"tx1"),ByteArray(32){2})
      fail("before-commit fault skipped") } catch (_: IllegalStateException) {}
    assertEquals("reconciled-uncommitted",store.recoverAbortedEpoch(groupId,"tx1",d1))
    assertEquals(1L,store.readEpochFence(groupId))
    failPoint = "after-commit"
    try { store.atomicCommitAddition("tx1",snapshot(2L,d1,"tx1"),ByteArray(32){2})
      fail("after-commit fault skipped") } catch (_: IllegalStateException) {}
    store.close()
    store = BushMeshSecurityV2TransactionStore(
      context,signer,authority,witness,filename=filename,
    )
    try { store.readGroup(groupId);fail("pending witness was ignored") }
      catch (_: IllegalArgumentException) {}
    assertEquals("reconciled-local-commit",store.recoverEpochWitness(groupId,"tx1",d1))
    assertEquals(2L,store.readEpochFence(groupId))
  }

  @Test fun testFreshRecipientInstallAndNoStaleEpochOrOwnerSwap() {
    store.provisionApprovedOwnerAnchor(groupId,"fp_owner",d0,"out-of-band-test-only")
    val committed=snapshot(2L,d1,"tx1")
    assertEquals("installed",store.atomicInstallEpoch("tx1",issued,committed,ByteArray(32){7}))
    assertEquals(issued,store.readInstalledDistribution("tx1"))
    assertEquals("already-installed-identical",
      store.atomicInstallEpoch("tx1",issued,committed,ByteArray(32){9}))
    try {
      store.atomicInstallEpoch("tx2",issued,committed,ByteArray(32){8})
      fail("stale epoch installed")
    } catch (_: IllegalArgumentException) {}
    try {
      store.provisionApprovedOwnerAnchor(groupId,"different",d0,"out-of-band-test-only")
      fail("owner pin changed")
    } catch (_: IllegalArgumentException) {}
  }

  @Test fun testIndependentWitnessRefusesOldWholeDatabaseAfterRestore() {
    initialized()
    // Simulates separately retained higher epoch witness while SQLite is old.
    witness.high[groupId]=2L
    try { store.readGroup(groupId);fail("rolled-back SQLite was trusted") }
      catch (_: IllegalArgumentException) {}
  }
}
