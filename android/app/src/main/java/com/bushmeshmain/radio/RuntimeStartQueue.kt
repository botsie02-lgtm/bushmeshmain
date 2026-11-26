package com.bushmeshmain.radio

/** Main-thread command ledger. Release invalidates only its own pending activations. */
internal class RuntimeStartQueue<T> {
  private data class Entry<T>(val radio: Boolean, val value: T)
  private val entries = linkedMapOf<Long, Entry<T>>()
  private var next = 0L

  fun add(radio: Boolean, value: T): Long = (++next).also { entries[it] = Entry(radio, value) }
  fun take(id: Long): T? = entries.remove(id)?.value
  fun cancel(radio: Boolean): List<T> {
    val ids = entries.filterValues { it.radio == radio }.keys
    return ids.mapNotNull { entries.remove(it)?.value }
  }
  fun isEmpty(): Boolean = entries.isEmpty()
}
