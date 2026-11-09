package com.bushmeshmain.radio

import org.junit.Assert.*
import org.junit.Test

class BushMeshTileCoordinatesTest {
  @Test fun mbtilesUsesTmsRowsNotXyz() {
    assertEquals(1256, BushMeshTileCoordinates.tmsRow(11, 791))
    assertEquals(0, BushMeshTileCoordinates.tmsRow(2, 3))
    assertEquals(3, BushMeshTileCoordinates.tmsRow(2, 0))
  }

  @Test fun rejectsOutOfRangeCoordinates() {
    assertFalse(BushMeshTileCoordinates.valid(2, 4, 0))
    assertFalse(BushMeshTileCoordinates.valid(25, 0, 0))
    assertTrue(BushMeshTileCoordinates.valid(3, 7, 7))
  }
}
