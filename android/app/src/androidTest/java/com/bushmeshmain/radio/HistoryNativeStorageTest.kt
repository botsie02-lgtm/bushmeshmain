package com.bushmeshmain.radio

import android.content.Context
import android.content.Intent
import android.os.Debug
import android.os.SystemClock
import android.util.Log
import android.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import androidx.test.platform.app.InstrumentationRegistry
import com.bushmeshmain.MainActivity
import com.bushmeshmain.MainApplication
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReadableMap
import java.security.MessageDigest
import com.facebook.react.bridge.ReactApplicationContext
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Scratch store only: never write real messages, prefs or the operational key alias. */
class HistoryNativeStorageTest {
  private fun nativeCall(call: (PromiseImpl) -> Unit): Pair<Boolean, Any?> {
    val result = AtomicReference<Any?>()
    val failure = AtomicReference(false)
    val done = CountDownLatch(1)
    call(PromiseImpl(Callback { values -> result.set(values.firstOrNull()); done.countDown() },
      Callback { values -> failure.set(true); result.set((values.firstOrNull() as? ReadableMap)?.getString("code")); done.countDown() }))
    assertTrue(done.await(30, TimeUnit.SECONDS))
    return Pair(!failure.get(), result.get())
  }

  private fun withScratch(test: (BushMeshPersistenceModule, android.content.SharedPreferences, String) -> Unit) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    check(context.packageName == "com.bushmeshmain.radioredesign")
    val suffix = UUID.randomUUID().toString()
    val name = "bushmesh_history_scratch_" + suffix
    val alias = "bushmesh_history_scratch_" + suffix
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    try {
      val host = (context.applicationContext as MainApplication).reactHost
      val deadline = SystemClock.uptimeMillis() + 20_000
      var reactContext: ReactApplicationContext? = null
      while (reactContext == null && SystemClock.uptimeMillis() < deadline) {
        reactContext = host.currentReactContext as? ReactApplicationContext
        if (reactContext == null) SystemClock.sleep(100)
      }
      test(BushMeshPersistenceModule(checkNotNull(reactContext) { "Live React application context unavailable" }, name, alias), context.getSharedPreferences(name, Context.MODE_PRIVATE), alias)
    } finally {
      instrumentation.runOnMainSync { activity.finish() }
      context.deleteSharedPreferences(name)
      KeyStore.getInstance("AndroidKeyStore").apply { load(null); if (containsAlias(alias)) deleteEntry(alias) }
    }
  }

  @Test fun retentionMarkerRejectsRegressionAndSingleSnapshotRollback() = withScratch { store, prefs, _ ->
    val old = """{"version":1,"savedAtMs":1,"messages":[]}"""
    assertTrue(nativeCall { store.saveMessages(old, it) }.first)
    val oldEnvelope = prefs.getString("encrypted_messages_snapshot", null)
    val retention = """{"version":1,"deletedIds":["removed"],"possibleReplayKeys":[]}"""
    val snapshot = """{"version":1,"savedAtMs":2,"retention":$retention,"messages":[]}"""
    assertTrue(nativeCall { store.saveMessagesWithRetention(snapshot, retention, it) }.first)
    val currentEnvelope = prefs.getString("encrypted_messages_snapshot", null)
    assertTrue(nativeCall { store.loadMessages(it) } == Pair(true, snapshot))
    assertFalse(nativeCall { store.saveMessages(old, it) }.first)
    assertFalse(nativeCall { store.clearMessages(it) }.first)
    val regressed = """{"version":1,"deletedIds":[],"possibleReplayKeys":[]}"""
    assertFalse(nativeCall { store.saveMessagesWithRetention(snapshot.replace(retention, regressed), regressed, it) }.first)
    assertTrue(prefs.edit().putString("encrypted_messages_snapshot", oldEnvelope).commit())
    assertFalse(nativeCall { store.loadMessages(it) }.first)
    assertTrue(prefs.edit().putString("encrypted_messages_snapshot", currentEnvelope).commit())
    assertTrue(nativeCall { store.loadMessages(it) } == Pair(true, snapshot))
  }

  private val config = "a".repeat(64)
  private fun snapshot(count: Int, retention: String? = null) = buildString(count * 484 + 128) {
    append("""{"version":1,"savedAtMs":1,""")
    if (retention != null) append(""""retention":$retention,""")
    append(""""messages":[""")
    for (i in 0 until count) {
      if (i > 0) append(',')
      append("""{"id":"scale-$i","channelIndex":"1","channelName":"Camp","text":"Synthetic message $i xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","direction":"sent","status":"accepted","createdAt":"2026-01-01T00:00:00Z","conversation":{"version":1,"provenance":"local-submission","radioId":"synthetic-radio","channelGeneration":"config:1:$config","channelIndex":"1","channelName":"Camp"}}""")
    }
    append("]}")
  }

  private fun digest(value: String): ByteArray {
    val md = MessageDigest.getInstance("SHA-256")
    // Benchmark fixtures are ASCII. Avoid an extra full-sized UTF-8 byte array.
    var offset = 0
    while (offset < value.length) {
      val end = minOf(value.length, offset + 8192)
      md.update(value.substring(offset, end).toByteArray(Charsets.UTF_8))
      offset = end
    }
    return md.digest()
  }

  private data class WriteResult(val bytes: Int, val digest: ByteArray, val elapsedMs: Long, val success: Boolean, val code: Any?, val heapBefore: Long, val heapAfter: Long)
  private fun write(store: BushMeshPersistenceModule, count: Int): WriteResult {
    val text = snapshot(count)
    val expected = digest(text)
    val runtime = Runtime.getRuntime()
    val before = runtime.totalMemory() - runtime.freeMemory()
    val start = SystemClock.elapsedRealtime()
    val result = nativeCall { store.saveMessages(text, it) }
    return WriteResult(text.length, expected, SystemClock.elapsedRealtime() - start, result.first, result.second, before, runtime.totalMemory() - runtime.freeMemory())
    // Only the small digest/metrics escape. No old plaintext held across saves.
  }
  private fun restore(store: BushMeshPersistenceModule, expected: ByteArray): Long {
    val start = SystemClock.elapsedRealtime()
    val result = nativeCall { store.loadMessages(it) }
    val elapsed = SystemClock.elapsedRealtime() - start
    assertTrue("Native restore must succeed", result.first)
    assertArrayEquals(expected, digest(result.second as String))
    return elapsed
  }
  private fun report(line: String) {
    Log.i("BushMeshHistoryScale", line)
    println(line)
  }
  private fun measureSupported(count: Int) = withScratch { store, prefs, _ ->
    val runtime = Runtime.getRuntime()
    val before = runtime.totalMemory() - runtime.freeMemory()
    val initial = write(store, count)
    report("RADIO_HISTORY_NATIVE_PHASE count=$count operation=initial success=${initial.success} bytes=${initial.bytes} ms=${initial.elapsedMs} heapBefore=${initial.heapBefore} heapAfter=${initial.heapAfter}")
    assertTrue("Initial write $count: ${initial.code}", initial.success)
    val restoreMs = restore(store, initial.digest)
    report("RADIO_HISTORY_NATIVE_PHASE count=$count operation=restore success=true ms=$restoreMs")
    val incremental = write(store, count + 1)
    report("RADIO_HISTORY_NATIVE_PHASE count=$count operation=incremental success=${incremental.success} bytes=${incremental.bytes} ms=${incremental.elapsedMs} heapBefore=${incremental.heapBefore} heapAfter=${incremental.heapAfter}")
    assertTrue("Incremental write $count: ${incremental.code}", incremental.success)
    val incrementalRestore = restore(store, incremental.digest)
    val heapDelta = runtime.totalMemory() - runtime.freeMemory() - before
    report("RADIO_HISTORY_NATIVE_SCALE count=$count status=committed bytes=${initial.bytes} initialMs=${initial.elapsedMs} restoreMs=$restoreMs incrementalMs=${incremental.elapsedMs} incrementalRestoreMs=$incrementalRestore javaHeapDelta=$heapDelta pssKb=${Debug.getPss()} heapLimit=${runtime.maxMemory()}")
    // Actual malformed-envelope recovery, with digest verification of prior data.
    val envelope = prefs.getString("encrypted_messages_snapshot", null)
    assertTrue(prefs.edit().putString("encrypted_messages_snapshot", "v1:invalid:invalid").commit())
    assertFalse(nativeCall { store.loadMessages(it) }.first)
    assertEquals("v1:invalid:invalid", prefs.getString("encrypted_messages_snapshot", null))
    assertTrue(prefs.edit().putString("encrypted_messages_snapshot", envelope).commit())
    restore(store, incremental.digest)
  }

  @Test fun syntheticNativeSnapshotScaleAndCorruptEnvelopeRecovery() {
    measureSupported(1000)
    measureSupported(10000)
    withScratch { store, prefs, _ ->
      // The largest fixture is still built and offered to the production
      // storage boundary. Explicitly require a controlled capacity rejection,
      // not a mocked success or a weakened test. No 50k restore is possible
      // if the initial write has been refused.
      val initial = write(store, 50000)
      assertFalse(initial.success)
      assertEquals("BUSHMESH_HISTORY_CAPACITY", initial.code)
      assertNull(prefs.getString("encrypted_messages_snapshot", null))
      assertEquals(Pair(true, null), nativeCall { store.loadMessages(it) })
      val baseline = write(store, 1000)
      assertTrue(baseline.success)
      val beforeEnvelope = prefs.getString("encrypted_messages_snapshot", null)
      val incremental = write(store, 50001)
      assertFalse(incremental.success)
      assertEquals("BUSHMESH_HISTORY_CAPACITY", incremental.code)
      assertEquals(beforeEnvelope, prefs.getString("encrypted_messages_snapshot", null))
      val verifiedMs = restore(store, baseline.digest)
      // A rejected retention-bearing transaction must not change either key.
      val retention = """{"version":1,"deletedIds":["removed"],"possibleReplayKeys":[]}"""
      val large = snapshot(50000, retention)
      val retained = nativeCall { store.saveMessagesWithRetention(large, retention, it) }
      assertFalse(retained.first)
      assertEquals("BUSHMESH_HISTORY_CAPACITY", retained.second)
      assertEquals(beforeEnvelope, prefs.getString("encrypted_messages_snapshot", null))
      assertNull(prefs.getString("encrypted_message_retention_guard_v1", null))
      restore(store, baseline.digest)
      report("RADIO_HISTORY_NATIVE_SCALE count=50000 status=capacity_rejected bytes=${initial.bytes} initialRejectMs=${initial.elapsedMs} incrementalCandidateBytes=${incremental.bytes} incrementalRejectMs=${incremental.elapsedMs} restoreMs=not_committed preservedBaselineRestoreMs=$verifiedMs retentionRejected=true initialHeapBefore=${initial.heapBefore} initialHeapAfter=${initial.heapAfter} incrementalHeapBefore=${incremental.heapBefore} incrementalHeapAfter=${incremental.heapAfter} pssKb=${Debug.getPss()} heapLimit=${Runtime.getRuntime().maxMemory()}")
    }
  }

  @Test fun streamingEnvelopeRetainsUnicodeAndChunkBoundaryCompatibility() = withScratch { store, prefs, alias ->
    val prefix = """{"version":1,"savedAtMs":1,"messages":[],"synthetic":""" + "\""
    val text = prefix + "a".repeat(8191 - prefix.length) + "🙂日本é" + "z".repeat(8192) + "\"}"
    // Use the scratch key, not operational history. Construct an envelope
    // with the exact old one-shot algorithm and verify it with current load.
    assertTrue(nativeCall { store.saveMessages(text, it) }.first)
    val key = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey(alias, null) as SecretKey
    val legacy = Cipher.getInstance("AES/GCM/NoPadding")
    legacy.init(Cipher.ENCRYPT_MODE, key)
    legacy.updateAAD("v1:messages".toByteArray(Charsets.UTF_8))
    val oldEnvelope = "v1:" + Base64.encodeToString(legacy.iv, Base64.NO_WRAP) + ":" +
      Base64.encodeToString(legacy.doFinal(text.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    assertTrue(prefs.edit().putString("encrypted_messages_snapshot", oldEnvelope).commit())
    assertEquals(Pair(true, text), nativeCall { store.loadMessages(it) })
    assertTrue(nativeCall { store.saveMessages(text, it) }.first)
    // The new streamed envelope is also readable by the old one-shot decoder.
    val parts = checkNotNull(prefs.getString("encrypted_messages_snapshot", null)).split(':', limit = 3)
    assertEquals("v1", parts[0])
    val decoder = Cipher.getInstance("AES/GCM/NoPadding")
    decoder.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(parts[1], Base64.NO_WRAP)))
    decoder.updateAAD("v1:messages".toByteArray(Charsets.UTF_8))
    assertEquals(text, String(decoder.doFinal(Base64.decode(parts[2], Base64.NO_WRAP)), Charsets.UTF_8))
  }

  @Test fun rejectedCommitRestoresBothValuesAndUncertainRollbackKeepsFence() = withScratch { store, prefs, _ ->
    val retention = """{"version":1,"deletedIds":["removed"],"possibleReplayKeys":[]}"""
    val snapshot = """{"version":1,"savedAtMs":2,"retention":$retention,"messages":[]}"""
    assertTrue(nativeCall { store.saveMessagesWithRetention(snapshot, retention, it) }.first)
    val old = prefs.getString("encrypted_messages_snapshot", null)
    val oldMarker = prefs.getString("encrypted_message_retention_guard_v1", null)
    var fenced = false
    var calls = 0
    // Simulate a commit returning failure *after* the real preference editor
    // has changed its values, then perform a real synchronous rollback.
    assertThrows(IllegalStateException::class.java) {
      HistoryCommitTransaction.commit(prefs, "encrypted_messages_snapshot", "encrypted_message_retention_guard_v1",
        "synthetic failed value", "synthetic failed guard", { fenced = it }) { editor ->
        calls++
        assertTrue(editor.commit())
        calls != 1
      }
    }
    assertEquals(2, calls)
    assertFalse(fenced)
    assertEquals(old, prefs.getString("encrypted_messages_snapshot", null))
    assertEquals(oldMarker, prefs.getString("encrypted_message_retention_guard_v1", null))
    assertEquals(Pair(true, snapshot), nativeCall { store.loadMessages(it) })
    // Fault injection: even a rollback which cannot confirm its write must
    // leave the transaction fence active. This is not a hardware I/O test.
    calls = 0
    assertThrows(IllegalStateException::class.java) {
      HistoryCommitTransaction.commit(prefs, "encrypted_messages_snapshot", "encrypted_message_retention_guard_v1",
        "synthetic failed value", "synthetic failed guard", { fenced = it }) { editor ->
        calls++
        assertTrue(editor.commit())
        false
      }
    }
    assertEquals(2, calls)
    assertTrue(fenced)
    assertEquals(Pair(true, snapshot), nativeCall { store.loadMessages(it) })
  }
}
