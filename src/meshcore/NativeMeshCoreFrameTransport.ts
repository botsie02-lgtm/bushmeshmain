import {Buffer} from 'buffer';

import {
  NativeRadioServiceStatus,
  nativeRadioService,
  waitForNativeRadioShutdown,
} from '../native/NativeRadioService';
import {nativeOutboundDiagnostics} from './nativeOutboundDiagnostics';
import {
  MeshCoreFrameTransport,
  MeshCoreFrameTransportHandlers,
} from './MeshCoreFrameTransport';

export type NativeMeshCoreFrameTransportOptions = {
  pollIntervalMs?: number;
  maxFramesPerPoll?: number;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
  onNativeStatus?: (status: NativeRadioServiceStatus) => void;
};

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_MAX_FRAMES_PER_POLL = 32;
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_STOP_TIMEOUT_MS = 6_000;
const GATT_WRITE_CONFIRMATION_TIMEOUT_MS = 4_000;

/**
 * MeshCore raw-frame transport backed by the Android foreground BLE runtime.
 *
 * Android buffers notifications while React Native is detached. When JS is
 * alive this class drains those complete NUS notifications and hands them to
 * the same MeshCore parser used by the existing BLE-PLX path. It intentionally
 * does not interpret protocol responses or claim peer delivery.
 */
export class NativeMeshCoreFrameTransport implements MeshCoreFrameTransport {
  readonly id: string;

  private readonly pollIntervalMs: number;
  private readonly maxFramesPerPoll: number;
  private readonly readyTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly onNativeStatus?: (status: NativeRadioServiceStatus) => void;
  private handlers: MeshCoreFrameTransportHandlers | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private pollTask: Promise<void> | null = null;
  private started = false;
  private generation = 0;

  constructor(
    private readonly deviceAddress: string,
    private readonly deviceLabel: string | null,
    options: NativeMeshCoreFrameTransportOptions = {},
  ) {
    this.id = `android-native:${deviceAddress}`;
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
    this.readyTimeoutMs = Math.max(
      1_000,
      Math.floor(options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS),
    );
    this.stopTimeoutMs = Math.max(
      250,
      Math.floor(options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS),
    );
    this.onNativeStatus = options.onNativeStatus;
  }

  isSupported(): boolean {
    return nativeRadioService.isSupported();
  }

  async start(handlers: MeshCoreFrameTransportHandlers): Promise<void> {
    this.handlers = handlers;
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
    this.handlers = null;
    this.clearPollTimer();
    // Do not leave a previous-generation drain consuming frames while another
    // foreground session is being constructed.
    if (this.pollTask) await this.pollTask.catch(() => undefined);
    nativeOutboundDiagnostics.record('stop-requested', 'radio-stop');
    const dispatched = await nativeRadioService.stop();
    if (!dispatched) {
      throw new Error('Android did not accept the native radio stop request.');
    }

    try {
      const status = await waitForNativeRadioShutdown({
        timeoutMs: this.stopTimeoutMs,
        pollIntervalMs: this.pollIntervalMs,
      });
      this.onNativeStatus?.(status);
      nativeOutboundDiagnostics.record('stop-confirmed', 'radio-stop');
    } catch (error) {
      nativeOutboundDiagnostics.record('stop-failed', 'radio-stop', {reason: 'shutdown-error'});
      throw error;
    }
  }

  async writeBase64(base64Frame: string): Promise<void> {
    if (!this.started) {
      throw new Error('Native MeshCore BLE transport has not been started.');
    }
    if (!base64Frame) {
      throw new Error('MeshCore BLE frame cannot be empty.');
    }

    const generation = this.generation;
    const previous = await nativeRadioService.getStatus();
    const completed = previous.nativeBleCompletedGattWrites;
    const failed = previous.nativeBleFailedGattWrites;
    if (previous.nativeBleState !== 'ready' ||
        typeof completed !== 'number' || typeof failed !== 'number') {
      nativeOutboundDiagnostics.record('write-failed', 'channel-text', {reason: 'disconnected'});
      throw new Error('Native GATT completion tracking is unavailable or transport is not ready.');
    }
    const bytes = Buffer.from(base64Frame, 'base64');
    const maxPayload = (previous.nativeBleMtu ?? 23) - 3;
    if (bytes.length > maxPayload) {
      nativeOutboundDiagnostics.record('write-failed', 'channel-text', {reason: 'write-error'});
      throw new Error('Native GATT MTU cannot carry this MeshCore command; submission not queued.');
    }

    const accepted = await nativeRadioService.enqueueNativeBleWrite(base64Frame);
    if (!accepted) {
      nativeOutboundDiagnostics.record('write-failed', 'channel-text', {reason: 'write-error'});
      throw new Error('Native BLE command was rejected by Android before GATT write.');
    }
    nativeOutboundDiagnostics.record('native-write-queued', 'channel-text');
    // JNI enqueueWrite only confirms a local buffer insertion, not a BLE write.
    // Wait for Android onCharacteristicWrite SUCCESS before letting the session
    // report that this command was physically written over GATT.
    const deadline = Date.now() + GATT_WRITE_CONFIRMATION_TIMEOUT_MS;
    while (this.started && generation === this.generation) {
      const status = await nativeRadioService.getStatus();
      if ((status.nativeBleFailedGattWrites ?? failed) > failed ||
          status.nativeBleState !== 'ready') {
        nativeOutboundDiagnostics.record('write-failed', 'channel-text', {reason: 'write-error'});
        throw new Error('Native GATT write failed or BLE link changed; radio submission is uncertain.');
      }
      if ((status.nativeBleCompletedGattWrites ?? completed) > completed) {
        nativeOutboundDiagnostics.record('gatt-write-confirmed', 'channel-text');
        return;
      }
      if (Date.now() >= deadline) {
        nativeOutboundDiagnostics.record('write-failed', 'channel-text', {reason: 'timeout'});
        throw new Error('Native GATT write acknowledgment timed out; packet may have transmitted. Do not automatically resend.');
      }
      await this.delay(this.pollIntervalMs);
    }
    nativeOutboundDiagnostics.record('session-disconnected', 'channel-text', {reason: 'disconnected'});
    throw new Error('Native radio stopped while awaiting GATT write acknowledgment; submission uncertain.');
  }

  async ensureReady(): Promise<number | null> {
    if (!this.started) {
      throw new Error('Native MeshCore BLE transport has not been started.');
    }

    const generation = this.generation;
    const deadline = Date.now() + this.readyTimeoutMs;
    let lastStatus: NativeRadioServiceStatus | null = null;

    while (this.started && generation === this.generation) {
      const status = await nativeRadioService.getStatus();
      lastStatus = status;
      this.onNativeStatus?.(status);

      if (status.nativeBleState === 'ready') {
        return typeof status.nativeBleMtu === 'number' && status.nativeBleMtu > 0
          ? status.nativeBleMtu
          : null;
      }

      if (status.nativeBleState === 'error') {
        throw new Error(
          status.nativeBleLastError ?? 'Native MeshCore BLE transport entered an error state.',
        );
      }

      if (Date.now() >= deadline) {
        break;
      }

      await this.delay(this.pollIntervalMs);
    }

    if (!this.started || generation !== this.generation) {
      throw new Error('Native MeshCore BLE readiness wait was cancelled.');
    }

    const state = lastStatus?.nativeBleState ?? 'unknown';
    const detail = lastStatus?.nativeBleLastError
      ? ` ${lastStatus.nativeBleLastError}`
      : '';
    throw new Error(
      `Native MeshCore BLE transport did not become ready within ${Math.round(
        this.readyTimeoutMs / 1000,
      )} seconds (state: ${state}).${detail}`,
    );
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
      const task = this.poll(generation);
      this.pollTask = task;
      task.catch(error => {
        this.handlers?.onError?.(
          error instanceof Error
            ? error.message
            : 'Native MeshCore BLE polling failed.',
        );
      }).finally(() => {
        if (this.pollTask === task) this.pollTask = null;
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

      this.onNativeStatus?.(status);
      this.handlers?.onStatus?.(
        `Native BLE ${status.nativeBleState ?? 'unknown'}${
          status.nativeBleMtu ? ` · MTU ${status.nativeBleMtu}` : ''
        }`,
      );

      for (const encoded of frames) {
        if (!this.started || generation !== this.generation) {
          return;
        }
        try {
          this.handlers?.onFrame(Array.from(Buffer.from(encoded, 'base64')));
        } catch (error) {
          this.handlers?.onError?.(
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private clearPollTimer(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}