package com.bushmeshmain.radio

import android.content.Context

/**
 * Cross-process-lifecycle lease for encrypted outbox mutation.
 *
 * The lease is intentionally tiny and stored separately from encrypted traffic.
 * It contains no message data or secrets; it only prevents a resurrected native
 * worker and a returning React process from concurrently rewriting the outbox.
 */
class BushMeshOutboxLease(context: Context) {
  companion object {
    private const val PREFS_NAME = "bushmesh_outbox_lease_v1"
    private const val KEY_OWNER = "owner"
    private const val KEY_EPOCH = "epoch"
    const val OWNER_FOREGROUND = "foreground"
    const val OWNER_BACKGROUND = "background"
  }

  data class Lease(
    val owner: String,
    val epoch: Long,
  )

  private val preferences = context.applicationContext.getSharedPreferences(
    PREFS_NAME,
    Context.MODE_PRIVATE,
  )

  @Synchronized
  fun claimForeground(): Lease = claim(OWNER_FOREGROUND)

  @Synchronized
  fun claimBackground(): Lease = claim(OWNER_BACKGROUND)

  fun current(): Lease {
    val owner = preferences.getString(KEY_OWNER, "") ?: ""
    val epoch = preferences.getLong(KEY_EPOCH, 0L)
    return Lease(owner = owner, epoch = epoch)
  }

  fun stillOwns(expected: Lease): Boolean {
    val current = current()
    return current.owner == expected.owner && current.epoch == expected.epoch
  }

  @Synchronized
  private fun claim(owner: String): Lease {
    val nextEpoch = (preferences.getLong(KEY_EPOCH, 0L) + 1L)
      .takeIf { it > 0L }
      ?: 1L
    val committed = preferences.edit()
      .putString(KEY_OWNER, owner)
      .putLong(KEY_EPOCH, nextEpoch)
      .commit()
    if (!committed) {
      throw IllegalStateException("Bushmesh could not claim the outbox $owner lease.")
    }
    return Lease(owner = owner, epoch = nextEpoch)
  }
}
