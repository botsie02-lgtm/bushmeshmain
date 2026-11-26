package com.bushmeshmain.radio

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.platform.app.InstrumentationRegistry
import com.bushmeshmain.MainActivity
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

private const val TEST_ADDRESS = "02:00:00:00:00:01"

abstract class RuntimeDeviceTest {
  protected val instrumentation = InstrumentationRegistry.getInstrumentation()
  protected val context: Context = instrumentation.targetContext

  protected fun command(action: String, address: String? = null): Exception? {
    val result = AtomicReference<Exception?>()
    val latch = CountDownLatch(1)
    BushMeshRadioService.dispatch(context, action, "emulator lifecycle test", address) {
      result.set(it)
      latch.countDown()
    }
    assertTrue("Native command timed out: $action", latch.await(20, TimeUnit.SECONDS))
    instrumentation.waitForIdleSync()
    return result.get()
  }

  protected fun assertReleased() {
    val native = MeshCoreNativeBleRuntime.get(context).status()
    assertFalse(BushMeshRadioServiceState.radioRequested)
    assertNull(BushMeshRadioServiceState.deviceAddress)
    assertNull(native.deviceAddress)
    assertEquals("disconnected", native.state)
    assertFalse(BushMeshRadioService.hasPersistedNativeTarget(context))
  }
}

class RuntimeLifecycleDeniedTest : RuntimeDeviceTest() {
  @Test fun freshDeniedPermissionsStopBeforeStartRepeatedStopAndPersistedRecoveryCleanup() {
    assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT))
    assertEquals(PackageManager.PERMISSION_DENIED, context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION))
    assertNull(command(BushMeshRadioService.ACTION_STOP))
    assertNull(command(BushMeshRadioService.ACTION_STOP))
    assertNull(command(BushMeshRadioService.ACTION_RELEASE_LOCATION))
    assertNull(command(BushMeshRadioService.ACTION_RELEASE_LOCATION))
    assertReleased()
    assertFalse(BushMeshRadioServiceState.running)
    assertTrue(command(BushMeshRadioService.ACTION_START, TEST_ADDRESS) is SecurityException)
    assertTrue(command(BushMeshRadioService.ACTION_REQUEST_LOCATION) is SecurityException)
    // Simulate a persisted target left by a previous process, not a radio connection.
    assertTrue(context.getSharedPreferences("bushmesh_radio_service", Context.MODE_PRIVATE).edit()
      .putString("native_device_address", TEST_ADDRESS)
      .putString("native_device_label", "previous target").commit())
    assertTrue(BushMeshRadioService.hasPersistedNativeTarget(context))
    assertTrue(command(BushMeshRadioService.ACTION_START) is SecurityException)
    assertTrue(BushMeshRadioService.hasPersistedNativeTarget(context))
    assertNull(command(BushMeshRadioService.ACTION_STOP))
    assertReleased()
    assertFalse(BushMeshRadioServiceState.running)
  }
}

class RuntimeLifecycleGrantedTest : RuntimeDeviceTest() {
  @Test fun disabledBluetoothPendingTargetAndIndependentForegroundTypes() {
    assertEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT))
    assertEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION))
    // Real visible activity, so location is eligible under while-in-use rules.
    val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    try {
      Thread.sleep(8_000) // let actual React startup effects finish
      assertNull(command(BushMeshRadioService.ACTION_STOP))
      assertNull(command(BushMeshRadioService.ACTION_RELEASE_LOCATION))
      val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
      assertFalse("Test requires disabled Bluetooth", adapter?.isEnabled == true)
      assertNull(command(BushMeshRadioService.ACTION_REQUEST_LOCATION))
      assertTrue(BushMeshRadioServiceState.locationRequested)
      assertNull(command(BushMeshRadioService.ACTION_START, TEST_ADDRESS))
      assertTrue(BushMeshRadioServiceState.radioRequested)
      assertTrue(BushMeshRadioService.hasPersistedNativeTarget(context))
      assertEquals(TEST_ADDRESS, MeshCoreNativeBleRuntime.get(context).status().deviceAddress)
      assertNull(command(BushMeshRadioService.ACTION_STOP))
      assertReleased()
      assertTrue(BushMeshRadioServiceState.locationRequested)
      assertTrue(BushMeshRadioServiceState.running)
      assertNull(command(BushMeshRadioService.ACTION_STOP))
      assertTrue(BushMeshRadioServiceState.locationRequested)
      // Recover a persisted target without overwriting it with a keepalive.
      assertTrue(context.getSharedPreferences("bushmesh_radio_service", Context.MODE_PRIVATE).edit()
        .putString("native_device_address", TEST_ADDRESS).commit())
      assertNull(command(BushMeshRadioService.ACTION_START))
      assertEquals(TEST_ADDRESS, BushMeshRadioServiceState.deviceAddress)
      assertNull(command(BushMeshRadioService.ACTION_RELEASE_LOCATION))
      assertTrue(BushMeshRadioServiceState.radioRequested)
      assertFalse(BushMeshRadioServiceState.locationRequested)
      assertTrue(BushMeshRadioServiceState.running)
      assertNull(command(BushMeshRadioService.ACTION_STOP))
      assertReleased()
      assertFalse(BushMeshRadioServiceState.running)
      Thread.sleep(1_500) // any scheduled reconnect must remain cancelled
      assertReleased()
    } finally {
      command(BushMeshRadioService.ACTION_STOP)
      command(BushMeshRadioService.ACTION_RELEASE_LOCATION)
      instrumentation.runOnMainSync { activity.finish() }
    }
  }
}
