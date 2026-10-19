package com.bushmeshmain.radio

object BushMeshRadioServiceState {
  @Volatile var running: Boolean = false
  @Volatile var deviceLabel: String? = null
  @Volatile var startedAtMs: Long = 0L

  fun markStarted(label: String?) {
    running = true
    deviceLabel = label?.takeIf { it.isNotBlank() }
    startedAtMs = System.currentTimeMillis()
  }

  fun markStopped() {
    running = false
    deviceLabel = null
    startedAtMs = 0L
  }
}
