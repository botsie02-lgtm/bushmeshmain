export type MeshCoreReassembler = {
  pushChunk: (bytes: number[]) => void;
  reset: () => void;
};

/**
 * MeshCore BLE notifications are already complete companion-protocol frames.
 *
 * Older BushMesh builds buffered notifications and flushed them after an idle
 * delay. That could merge two legitimate back-to-back MeshCore responses into
 * one invalid frame. Keep this compatibility wrapper for now, but forward each
 * BLE notification immediately and independently.
 *
 * The idleMs argument is intentionally retained so existing call sites do not
 * need to change in the same migration.
 */
export function createIdleReassembler(
  onFrameReady: (bytes: number[]) => void,
  _idleMs = 350,
): MeshCoreReassembler {
  return {
    pushChunk: (bytes: number[]) => {
      if (bytes.length > 0) {
        onFrameReady([...bytes]);
      }
    },

    reset: () => {
      // BLE notification frames are not buffered, so there is nothing to reset.
    },
  };
}
