package com.bushmeshmain.radio

import android.content.SharedPreferences

/** Both values are committed by one SharedPreferences Editor. A rejected
 * disk commit can still mutate its memory map. Restore the old values
 * synchronously before allowing another write; keep the fence on if the
 * rollback fails. The injected commit function is only used in fault tests. */
internal object HistoryCommitTransaction {
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
