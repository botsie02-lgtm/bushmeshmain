package com.bushmeshmain.radio

/** XYZ for the viewport/PMTiles; MBTiles is TMS with Y running bottom-to-top. */
internal object BushMeshTileCoordinates {
  fun valid(z: Int, x: Int, y: Int): Boolean =
    z in 0..24 && x >= 0 && y >= 0 && x < (1 shl z) && y < (1 shl z)

  fun tmsRow(z: Int, xyzY: Int): Int {
    require(z in 0..24) { "MBTiles zoom exceeds supported range." }
    val count = 1 shl z
    require(xyzY in 0 until count) { "Invalid XYZ tile Y." }
    return count - 1 - xyzY
  }
}
