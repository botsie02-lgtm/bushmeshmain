package com.bushmeshmain.radio

import org.junit.Assert.*
import org.junit.Test

class HistorySnapshotBudgetTest {
  private val mib = 1024L * 1024
  @Test fun utf8LengthMatchesJvmEncodingWithoutAllocatingFullCopy() {
    for (value in listOf("", "ASCII", "é日本", "🙂", "a\uD800b", "\uDC00", "a".repeat(8191) + "🙂")) {
      assertEquals(value.toByteArray(Charsets.UTF_8).size.toLong(), HistorySnapshotBudget.utf8Bytes(value))
    }
  }
  @Test fun capacityUsesBytesHeapAndHeadroomNotMessageCount() {
    HistorySnapshotBudget.requireWrite(5*mib,192*mib,100*mib)
    assertThrows(HistoryCapacityException::class.java) { HistorySnapshotBudget.requireWrite(24*mib,192*mib,192*mib) }
    assertThrows(HistoryCapacityException::class.java) { HistorySnapshotBudget.requireWrite(5*mib,192*mib,60*mib) }
    assertThrows(HistoryCapacityException::class.java) { HistorySnapshotBudget.requireWrite(6*mib,64*mib,64*mib) }
    assertThrows(HistoryCapacityException::class.java) { HistorySnapshotBudget.requireRestore(32*mib,100*mib) }
    HistorySnapshotBudget.requireRestore(7*mib,100*mib)
  }
}
