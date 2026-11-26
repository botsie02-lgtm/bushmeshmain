package com.bushmeshmain.radio

import android.content.SharedPreferences

/** Both values are committed by one SharedPreferences Editor. A rejected
 * disk commit can still mutate its memory map. Restore the old values
 * synchronously before allowing another write; keep the fence on if the
 * rollback fails. The injected commit function is only used in fault tests. */
internal object HistoryCommitTransaction {
  // The native background outbox also commits to this XML preference file.
  // Serialize only the commit/rollback window, not encryption or JSON work.
  private val storeLock = Any()
  private val uncertainStores = mutableSetOf<String>()

  fun isUncertain(name: String): Boolean = synchronized(storeLock) { name in uncertainStores }
  fun requireWritable(name: String) {
    check(!isUncertain(name)) { "Shared encrypted store recovery is uncertain. Restart before retrying." }
  }
  fun setUncertain(name: String, uncertain: Boolean) {
    synchronized(storeLock) { if (uncertain) uncertainStores.add(name) else uncertainStores.remove(name) }
  }
  fun <T> withStoreWrite(name: String, operation: () -> T): T = synchronized(storeLock) {
    requireWritable(name)
    operation()
  }

  fun commit(
    prefs: SharedPreferences,
    snapshotKey: String,
    markerKey: String,
    snapshot: String?,
    marker: String?,
    fence: (Boolean) -> Unit,
    write: (SharedPreferences.Editor) -> Boolean = { it.commit() },
  ) {
    val beforeSnapshot = prefs.getString(snapshotKey, null)
    val beforeMarker = prefs.getString(markerKey, null)
    fun edit(value: String?, guard: String?): SharedPreferences.Editor =
      prefs.edit().putString(snapshotKey, value).putString(markerKey, guard)
    fence(true)
    try {
      check(write(edit(snapshot, marker)))
    } catch (failure: Exception) {
      if (write(edit(beforeSnapshot, beforeMarker))) fence(false)
      throw failure
    } catch (failure: OutOfMemoryError) {
      if (write(edit(beforeSnapshot, beforeMarker))) fence(false)
      throw failure
    }
    fence(false)
  }
}
