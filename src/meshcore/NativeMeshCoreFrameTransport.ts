import {Buffer} from 'buffer';

import {
  NativeRadioServiceStatus,
  nativeRadioService,
} from '../native/NativeRadioService';

export type NativeMeshCoreFrameTransportEvents = {
  onFrame: (bytes: number[]) => void;
  onStatus?: (status: NativeRadioServiceStatus) => void;
  onError?: (message: string) => void;
};

export type NativeMeshCoreFrameTransportOptions = {
  pollIntervalMs?: number;
  maxFramesPerPoll?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_MAX_FRAMES_PER_POLL = 32;

/**
 * MeshCore raw-frame transport backed by the Android foreground BLE runtime.
 *
 * Android buffers notifications while React Native is detached. When JS is
 * alive this class drains those complete NUS notifications and hands them to
 * the same MeshCore parser used by the existing BLE-PLX path. It intentionally
 * does not interpret protocol responses or claim peer delivery.
 */
export class NativeMeshCoreFrameTransport {
  private readonly pollIntervalMs: number;
  private readonly maxFramesPerPoll: number;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private started = false;
  private generation = 0;

  constructor(
    private readonly deviceAddress: string,
    private readonly deviceLabel: string | null,
    private readonly events: NativeMeshCoreFrameTransportEvents,
    options: NativeMeshCoreFrameTransportOptions = {},
  ) {
    this.pollIntervalMs = Math.max(
      25,
      Math.floor(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS),
    );
    this.maxFramesPerPoll = Math.max(
      1,
      Math.min(
        128,
        Math.floor(options.maxFramesPerPoll ?? DEFAULT_MAX_FRAMES_PER_POLL),
      ),
    );
  }

  isSupported(): boolean {
    return nativeRadioService.isSupported();
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    if (!this.isSupported()) {
      throw new Error('Native MeshCore BLE transport is only available on Android.');
    }

    const started = await nativeRadioService.startNativeBle(
      this.deviceAddress,
      this.deviceLabel,
    );
    if (!started) {
      throw new Error('Android did not accept native MeshCore BLE ownership.');
    }

    this.started = true;
    this.generation += 1;
    this.schedulePoll(0, this.generation);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.generation += 1;
    this.clearPollTimer();
    await nativeRadioService.stop();
  }

  async write(bytes: number[] | Uint8Array): Promise<void> {
    if (!this.started) {
      throw new Error('Native MeshCore BLE transport has not been started.');
    }
    if (bytes.length === 0) {
      throw new Error('MeshCore BLE frame cannot be empty.');
    }

    const encoded = Buffer.from(bytes).toString('base64');
    const accepted = await nativeRadioService.enqueueNativeBleWrite(encoded);
    if (!accepted) {
      const status = await nativeRadioService.getStatus();
      const detail = status.nativeBleLastError
        ? ` ${status.nativeBleLastError}`
        : '';
      throw new Error(`Android native BLE transport rejected the write.${detail}`);
    }
  }

  async getStatus(): Promise<NativeRadioServiceStatus> {
    return nativeRadioService.getStatus();
  }

  private schedulePoll(delayMs: number, generation: number): void {
    if (!this.started || generation !== this.generation) {
      return;
    }

    this.clearPollTimer();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.poll(generation).catch(error => {
        this.events.onError?.(
          error instanceof Error
            ? error.message
            : 'Native MeshCore BLE polling failed.',
        );
      });
    }, delayMs);
  }

  private async poll(generation: number): Promise<void> {
    if (!this.started || this.polling || generation !== this.generation) {
      return;
    }

    this.polling = true;
    try {
      const [status, frames] = await Promise.all([
        nativeRadioService.getStatus(),
        nativeRadioService.drainNativeBleFrames(this.maxFramesPerPoll),
      ]);

      if (!this.started || generation !== this.generation) {
        return;
      }

      this.events.onStatus?.(status);

      for (const encoded of frames) {
        if (!this.started || generation !== this.generation) {
          return;
        }
        try {
          this.events.onFrame(Array.from(Buffer.from(encoded, 'base64')));
        } catch (error) {
          this.events.onError?.(
            error instanceof Error
              ? `Invalid buffered MeshCore BLE frame: ${error.message}`
              : 'Invalid buffered MeshCore BLE frame.',
          );
        }
      }
    } finally {
      this.polling = false;
      if (this.started && generation === this.generation) {
        this.schedulePoll(this.pollIntervalMs, generation);
      }
    }
  }

  private clearPollTimer(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
