package com.bushmeshmain.radio

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatInvitationQrTest {
  @Test fun syntheticInvitationRoundTripsOffline() {
    // Synthetic test credential; not an operational radio key.
    val invitation = "BUSHMESH-CHAT-1:eyJuYW1lIjoiVGVzdCIsInNlY3JldEhleCI6IjExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExIn0="
    val matrix = QRCodeWriter().encode(invitation, BarcodeFormat.QR_CODE, 512, 512)
    val pixels = IntArray(matrix.width * matrix.height) { i ->
      if (matrix.get(i % matrix.width, i / matrix.width)) 0xff000000.toInt() else 0xffffffff.toInt()
    }
    val decoded = QRCodeReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(matrix.width, matrix.height, pixels))))
    assertEquals(invitation, decoded.text)
  }
}
