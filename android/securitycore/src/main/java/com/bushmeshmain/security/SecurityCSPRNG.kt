package com.bushmeshmain.security

import java.security.SecureRandom

/** Fresh native CSPRNG on every call; never exposes a global cached byte pool. */
object SecurityCSPRNG {
  private val source = SecureRandom()

  @Synchronized fun next(length: Int): ByteArray {
    require(length in 1..1024) { "Synchronous native entropy request out of bounds" }
    return ByteArray(length).also(source::nextBytes)
  }
}
