package com.bushmeshmain

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  // Main-looper-only evidence of the actual Android activity lifecycle.
  // A React listener's deferred resume notification cannot grant microphone
  // access when this activity is paused or destroyed.
  internal var voiceForegroundResumed = false
    private set
  internal var voiceForegroundEpoch = 0L
    private set

  override fun onResume() {
    voiceForegroundEpoch++
    voiceForegroundResumed = true
    super.onResume()
  }

  override fun onPause() {
    voiceForegroundResumed = false
    voiceForegroundEpoch++
    super.onPause()
  }

  override fun onDestroy() {
    voiceForegroundResumed = false
    voiceForegroundEpoch++
    super.onDestroy()
  }


  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "bushmeshmain"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
