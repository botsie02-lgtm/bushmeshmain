package com.bushmeshmain.radio

import android.content.Context
import android.os.Debug
import android.os.SystemClock
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.PromiseImpl
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
      Callback { _ -> failure.set(true); done.countDown() }))
    assertTrue(done.await(30, TimeUnit.SECONDS))
    return Pair(!failure.get(), result.get())
  }

  private fun withScratch(test: (BushMeshPersistenceModule, android.content.SharedPreferences) -> Unit) {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    check(context.packageName == "com.bushmeshmain.radioredesign")
    val suffix = UUID.randomUUID().toString()
    val name = "bushmesh_history_scratch_" + suffix
    val alias = "bushmesh_history_scratch_" + suffix
    try {
      test(BushMeshPersistenceModule(ReactApplicationContext(context), name, alias), context.getSharedPreferences(name, Context.MODE_PRIVATE))
    } finally {
      context.deleteSharedPreferences(name)
      KeyStore.getInstance("AndroidKeyStore").apply { load(null); if (containsAlias(alias)) deleteEntry(alias) }
    }
  }

  @Test fun retentionMarkerRejectsRegressionAndSingleSnapshotRollback() = withScratch { store, prefs ->
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

  @Test fun syntheticNativeSnapshotScaleAndCorruptEnvelopeRecovery() = withScratch { store, prefs ->
    val runtime = Runtime.getRuntime()
    val config = "a".repeat(64)
    fun snapshot(count: Int) = buildString {
      append("""{"version":1,"savedAtMs":1,"messages":[""")
      for (i in 0 until count) {
        if (i > 0) append(',')
        // Representative outgoing scoped records; the host fixture separately
        // exercises larger full incoming observation objects.
        append("""{"id":"scale-$i","channelIndex":"1","channelName":"Camp","text":"Synthetic message $i xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","direction":"sent","status":"accepted","createdAt":"2026-01-01T00:00:00Z","conversation":{"version":1,"provenance":"local-submission","radioId":"synthetic-radio","channelGeneration":"config:1:$config","channelIndex":"1","channelName":"Camp"}}""")
      }
      append("]}")
    }
    for (count in listOf(1000, 10000, 50000)) {
      val before = runtime.totalMemory() - runtime.freeMemory()
      val text = snapshot(count)
      var started = SystemClock.elapsedRealtime()
      assertTrue(nativeCall { store.saveMessages(text, it) }.first)
      val initial = SystemClock.elapsedRealtime() - started
      started = SystemClock.elapsedRealtime()
      assertTrue(nativeCall { store.loadMessages(it) } == Pair(true, text))
      val restore = SystemClock.elapsedRealtime() - started
      val next = snapshot(count + 1)
      started = SystemClock.elapsedRealtime()
      assertTrue(nativeCall { store.saveMessages(next, it) }.first)
      val write = SystemClock.elapsedRealtime() - started
      val heapDelta = runtime.totalMemory() - runtime.freeMemory() - before
      Log.i("BushMeshHistoryScale", "RADIO_HISTORY_NATIVE_SCALE count=$count bytes=${text.length} initialMs=$initial restoreMs=$restore incrementalMs=$write javaHeapDelta=$heapDelta pssKb=${Debug.getPss()}")
      println("RADIO_HISTORY_NATIVE_SCALE count=$count bytes=${text.length} initialMs=$initial restoreMs=$restore incrementalMs=$write javaHeapDelta=$heapDelta pssKb=${Debug.getPss()}")
    }
    val envelope = prefs.getString("encrypted_messages_snapshot", null)
    assertTrue(prefs.edit().putString("encrypted_messages_snapshot", "v1:invalid:invalid").commit())
    assertFalse(nativeCall { store.loadMessages(it) }.first)
    assertEquals("v1:invalid:invalid", prefs.getString("encrypted_messages_snapshot", null))
    assertTrue(prefs.edit().putString("encrypted_messages_snapshot", envelope).commit())
    assertTrue(nativeCall { store.loadMessages(it) }.first)
  }
}
