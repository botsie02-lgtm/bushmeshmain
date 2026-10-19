package com.bushmeshmain.radio

object BushMeshRadioServiceState {
  @Volatile var running: Boolean = false
  @Volatile var radioRequested: Boolean = false
  @Volatile var locationRequested: Boolean = false
  @Volatile var deviceLabel: String? = null
  @Volatile var startedAtMs: Long = 0L

  fun requestRadio(label: String?) {
    radioRequested = true
    deviceLabel = label?.takeIf { it.isNotBlank() }
  }

  fun releaseRadio() {
    radioRequested = false
    deviceLabel = null
  }

  fun requestLocation() {
    locationRequested = true
  }

  fun releaseLocation() {
    locationRequested = false
  }

  fun shouldRun(): Boolean = radioRequested || locationRequested

  fun markRunning() {
    if (!running) {
      startedAtMs = System.currentTimeMillis()
    }
    running = true
  }

  fun markStopped() {
    running = false
    radioRequested = false
    locationRequested = false
    deviceLabel = null
    startedAtMs = 0L
  }
}
