package com.bushmeshmain.radio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MeshCoreBleConnectionPolicyTest {
  @Test fun sameTargetMayReuseOneHealthyGatt() {
    assertTrue(MeshCoreBleConnectionPolicy.mayReuseGatt(
      "AA:BB:CC:DD:EE:FF", "AA:BB:CC:DD:EE:FF", "ready", true,
    ))
    assertTrue(MeshCoreBleConnectionPolicy.mayReuseGatt(
      "AA:BB:CC:DD:EE:FF", "AA:BB:CC:DD:EE:FF", "connecting", true,
    ))
  }

  @Test fun deviceSwitchNeverReusesOldGatt() {
    assertFalse(MeshCoreBleConnectionPolicy.mayReuseGatt(
      "AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66", "ready", true,
    ))
    assertFalse(MeshCoreBleConnectionPolicy.mayReuseGatt(
      "AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66", "connecting", true,
    ))
  }

  @Test fun stoppedErrorAndReconnectingGattCannotBeReused() {
    for (state in listOf("disconnected", "disconnecting", "error", "reconnecting")) {
      assertFalse(MeshCoreBleConnectionPolicy.mayReuseGatt(
        "AA:BB:CC:DD:EE:FF", "AA:BB:CC:DD:EE:FF", state, true,
      ))
    }
    assertFalse(MeshCoreBleConnectionPolicy.mayReuseGatt(
      "AA:BB:CC:DD:EE:FF", "AA:BB:CC:DD:EE:FF", "ready", false,
    ))
  }

  @Test fun connectionWatchdogOnlyRunsDuringHandshake() {
    for (state in listOf("connecting", "negotiating-mtu", "discovering-services", "enabling-notifications")) {
      assertTrue(MeshCoreBleConnectionPolicy.needsConnectionTimeout(state))
    }
    for (state in listOf("ready", "reconnecting", "disconnected", "error")) {
      assertFalse(MeshCoreBleConnectionPolicy.needsConnectionTimeout(state))
    }
  }
}
