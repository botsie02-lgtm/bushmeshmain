package com.bushmeshmain.radio

/**
 * Pure decisions for one native GATT owner. A target change must never reuse a
 * connection (or pending writes/responses) belonging to another address.
 */
internal object MeshCoreBleConnectionPolicy {
  fun mayReuseGatt(
    currentAddress: String?,
    requestedAddress: String,
    state: String,
    hasGatt: Boolean,
  ): Boolean =
    hasGatt &&
      currentAddress == requestedAddress &&
      state !in setOf("disconnected", "disconnecting", "error", "reconnecting")

  fun needsConnectionTimeout(state: String): Boolean =
    state in setOf(
      "connecting",
      "negotiating-mtu",
      "discovering-services",
      "enabling-notifications",
    )
}
