import {NativeMeshCoreFrameTransport} from './NativeMeshCoreFrameTransport';
import {
  NativeMeshCoreResponse,
  NativeMeshCoreSession,
  NativeMeshCoreSessionEvents,
} from './NativeMeshCoreSession';

export type NativeMeshCoreOwnershipState =
  | 'idle'
  | 'taking-over'
  | 'active'
  | 'stopping'
  | 'error';

export type NativeMeshCoreOwnershipSnapshot = {
  state: NativeMeshCoreOwnershipState;
  deviceAddress: string | null;
  deviceLabel: string | null;
  statusMessage: string | null;
  errorMessage: string | null;
  lastFrame: NativeMeshCoreResponse | null;
};

export type NativeMeshCoreOwnershipEvents = NativeMeshCoreSessionEvents;

type Listener = () => void;

const initialSnapshot: NativeMeshCoreOwnershipSnapshot = {
  state: 'idle',
  deviceAddress: null,
  deviceLabel: null,
  statusMessage: null,
  errorMessage: null,
  lastFrame: null,
};

/**
 * Owns the process-side half of the RN -> Android radio handoff.
 *
 * The caller must release any BLE-PLX connection before calling start(). This
 * coordinator then owns exactly one native MeshCore protocol session until
 * stop() completes. Keeping the lifecycle centralized prevents two UI surfaces
 * from independently claiming the same Android GATT runtime.
 */
export class NativeMeshCoreSessionCoordinator {
  private session: NativeMeshCoreSession | null = null;
  private listeners = new Set<Listener>();
  private snapshot: NativeMeshCoreOwnershipSnapshot = {...initialSnapshot};
  private lifecyclePromise: Promise<void> | null = null;
  private events: NativeMeshCoreOwnershipEvents = {};

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): NativeMeshCoreOwnershipSnapshot {
    return {
      ...this.snapshot,
      lastFrame: this.snapshot.lastFrame
        ? {
            ...this.snapshot.lastFrame,
            bytes: [...this.snapshot.lastFrame.bytes],
          }
        : null,
    };
  }

  isActive(): boolean {
    return this.snapshot.state === 'active' && this.session !== null;
  }

  getSession(): NativeMeshCoreSession | null {
    return this.session;
  }

  async start(
    deviceAddress: string,
    deviceLabel: string | null,
    events: NativeMeshCoreOwnershipEvents = {},
  ): Promise<NativeMeshCoreSession> {
    const address = deviceAddress.trim();
    if (!address) {
      throw new Error('Native radio handoff requires a Bluetooth device address.');
    }

    if (this.lifecyclePromise) {
      await this.lifecyclePromise;
      if (this.isActive() && this.snapshot.deviceAddress === address) {
        return this.session as NativeMeshCoreSession;
      }
    }

    if (this.session) {
      if (
        this.snapshot.state === 'active' &&
        this.snapshot.deviceAddress === address
      ) {
        return this.session;
      }
      throw new Error(
        'Another native MeshCore session is already active. Stop it before taking over a different radio.',
      );
    }

    this.events = events;
    this.setSnapshot({
      state: 'taking-over',
      deviceAddress: address,
      deviceLabel,
      statusMessage: 'Starting Android-owned MeshCore radio…',
      errorMessage: null,
      lastFrame: null,
    });

    const transport = new NativeMeshCoreFrameTransport(address, deviceLabel, {
      onNativeStatus: status => {
        const nativeState = status.nativeBleState ?? 'unknown';
        this.updateStatus(`Android BLE ${nativeState}.`);
      },
    });

    const session = new NativeMeshCoreSession(transport, {
      onStatus: message => {
        this.updateStatus(message);
        this.events.onStatus?.(message);
      },
      onError: message => {
        this.updateError(message);
        this.events.onError?.(message);
      },
      onFrame: response => {
        this.snapshot = {...this.snapshot, lastFrame: response};
        this.emit();
        this.events.onFrame?.(response);
      },
      onBushMeshMessage: message => {
        this.events.onBushMeshMessage?.(message);
      },
    });

    this.session = session;
    const lifecycle = session
      .start('BushMesh')
      .then(() => {
        if (this.session !== session) {
          return;
        }
        this.setSnapshot({
          ...this.snapshot,
          state: 'active',
          statusMessage: 'Android owns the MeshCore BLE connection.',
          errorMessage: null,
        });
      })
      .catch(async error => {
        const message =
          error instanceof Error
            ? error.message
            : 'Native MeshCore radio takeover failed.';
        if (this.session === session) {
          this.session = null;
        }
        try {
          await session.stop();
        } catch {
          // Preserve the original takeover error.
        }
        this.setSnapshot({
          state: 'error',
          deviceAddress: address,
          deviceLabel,
          statusMessage: null,
          errorMessage: message,
          lastFrame: this.snapshot.lastFrame,
        });
        throw error;
      })
      .finally(() => {
        if (this.lifecyclePromise === lifecycle) {
          this.lifecyclePromise = null;
        }
      });

    this.lifecyclePromise = lifecycle;
    await lifecycle;
    return session;
  }

  async stop(): Promise<void> {
    if (this.lifecyclePromise) {
      try {
        await this.lifecyclePromise;
      } catch {
        // A failed start is already reflected in coordinator state.
      }
    }

    const session = this.session;
    if (!session) {
      this.events = {};
      this.setSnapshot({...initialSnapshot});
      return;
    }

    this.setSnapshot({
      ...this.snapshot,
      state: 'stopping',
      statusMessage: 'Stopping Android-owned MeshCore radio…',
      errorMessage: null,
    });

    this.session = null;
    try {
      await session.stop();
      this.events = {};
      this.setSnapshot({...initialSnapshot});
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Native MeshCore radio shutdown failed.';
      this.events = {};
      this.setSnapshot({
        ...initialSnapshot,
        state: 'error',
        errorMessage: message,
      });
      throw error;
    }
  }

  private updateStatus(message: string): void {
    this.snapshot = {
      ...this.snapshot,
      statusMessage: message,
    };
    this.emit();
  }

  private updateError(message: string): void {
    this.snapshot = {
      ...this.snapshot,
      errorMessage: message,
    };
    this.emit();
  }

  private setSnapshot(snapshot: NativeMeshCoreOwnershipSnapshot): void {
    this.snapshot = snapshot;
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach(listener => listener());
  }
}

export const nativeMeshCoreSessionCoordinator =
  new NativeMeshCoreSessionCoordinator();
