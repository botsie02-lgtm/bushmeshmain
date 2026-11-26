package com.bushmeshmain.radio

import android.content.Context

/** Non-secret global presentation policy. No channel-slot attribution. */
internal class RadioNotificationPresentation(context: Context) {
  private val preferences = context.applicationContext.getSharedPreferences("bushmesh_radio_notification_presentation", Context.MODE_PRIVATE)
  fun showPreview(): Boolean = preferences.getBoolean("show_preview", true)
  fun setPreview(show: Boolean): Boolean = preferences.edit().putBoolean("show_preview", show).commit()
}
internal fun notificationPreview(text: String, show: Boolean): String =
  if (show) text else "New radio message"
