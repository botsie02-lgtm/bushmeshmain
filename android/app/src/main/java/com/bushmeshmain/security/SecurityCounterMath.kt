package com.bushmeshmain.security

import java.math.BigInteger

/** Pure JVM-testable unsigned 64-bit nonce and replay state arithmetic. */
internal object SecurityCounterMath {
  val MAX = BigInteger("18446744073709551615")

  fun u64(value: String): BigInteger {
    require(Regex("(0|[1-9][0-9]{0,19})").matches(value))
    return BigInteger(value).also { require(it >= BigInteger.ZERO && it <= MAX) }
  }

  /** Never issue the final 64-bit counter twice, even after a crash. */
  fun reserve(counter: BigInteger, high: BigInteger, floor: BigInteger): BigInteger {
    require(counter >= high) { "Nonce counter is below its durable high-watermark" }
    val next = counter.max(high).max(floor).add(BigInteger.ONE)
    require(next <= MAX) { "Nonce exhausted" }
    return next
  }

  data class Replay(val highest: BigInteger, val bitmap: BigInteger, val window: Int)
  data class Decision(val accept: Boolean, val state: Replay?)

  fun replay(previous: Replay?, incoming: BigInteger, size: Int): Decision {
    require(size in 8..1024 && incoming >= BigInteger.ZERO && incoming <= MAX)
    if (incoming == BigInteger.ZERO) return Decision(false, previous)
    if (previous == null) return Decision(true, Replay(incoming, BigInteger.ONE, size))
    require(previous.window == size) { "Replay window size changed" }
    if (incoming > previous.highest) {
      val advance = incoming - previous.highest
      val moved = if (advance >= BigInteger.valueOf(size.toLong())) BigInteger.ZERO
        else previous.bitmap.shiftLeft(advance.toInt())
      val mask = BigInteger.ONE.shiftLeft(size).subtract(BigInteger.ONE)
      return Decision(true, Replay(incoming, moved.or(BigInteger.ONE).and(mask), size))
    }
    val delta = previous.highest - incoming
    if (delta >= BigInteger.valueOf(size.toLong()) || previous.bitmap.testBit(delta.toInt())) {
      return Decision(false, previous)
    }
    return Decision(true, previous.copy(bitmap = previous.bitmap.setBit(delta.toInt())))
  }
}
