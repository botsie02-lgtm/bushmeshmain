export type MeshCoreReassembler = {
  pushChunk: (bytes: number[]) => void;
  reset: () => void;
};

export function createIdleReassembler(
  onFrameReady: (bytes: number[]) => void,
  idleMs = 350,
): MeshCoreReassembler {
  let buffer: number[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    const frame = buffer;
    buffer = [];
    timer = null;

    if (frame.length > 0) {
      onFrameReady(frame);
    }
  };

  return {
    pushChunk: (bytes: number[]) => {
      buffer = [...buffer, ...bytes];

      if (timer) {
        clearTimeout(timer);
      }

      timer = setTimeout(flush, idleMs);
    },

    reset: () => {
      buffer = [];

      if (timer) {
        clearTimeout(timer);
      }

      timer = null;
    },
  };
}