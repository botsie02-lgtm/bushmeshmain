package com.bushmeshmain.radio
import org.junit.Assert.assertEquals
import org.junit.Test
class RadioNotificationPresentationTest {
  @Test fun previewPolicyRedactsMessageOnly() {
    assertEquals("New radio message", notificationPreview("private text", false))
    assertEquals("private text", notificationPreview("private text", true))
  }
}
