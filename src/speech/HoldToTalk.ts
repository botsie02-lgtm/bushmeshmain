import type {
  HeldSpeechPartial,
  NativeSpeechRecognitionResult,
} from '../native/NativeSpeechRecognition';

export type HeldRecognitionAdapter = {
  permission: () => Promise<boolean>;
  recognize: (locale: string, requestId: string) => Promise<NativeSpeechRecognitionResult>;
  finish: (requestId: string, cancel: boolean) => Promise<boolean>;
  subscribePartial: (listener: (partial: HeldSpeechPartial) => void) => () => void;
};

type Turn = {
  id: string;
  started: boolean;
  released: boolean;
  cancelled: boolean;
};

let sequence = 0;

/**
 * One press is one finite native turn. A release before permission completes
 * cannot start capture later. IDs fence late releases/partials, including when
 * a platform recognizer ends a turn early. This adapter only returns text;
 * it never chooses a destination or invokes a message send.
 */
export class HoldToTalk {
  private current: Turn | null = null;

  constructor(private readonly adapter: HeldRecognitionAdapter) {}

  async press(
    locale = 'en-AU',
    onPartial?: (text: string) => void,
  ): Promise<NativeSpeechRecognitionResult | null> {
    if (this.current) {
      throw new Error('A held recognition turn is already active.');
    }
    const turn: Turn = {
      id: 'held-' + (++sequence),
      started: false,
      released: false,
      cancelled: false,
    };
    this.current = turn;
    let unsubscribe: (() => void) | undefined;
    try {
      const permitted = await this.adapter.permission();
      if (turn.cancelled || turn.released || this.current !== turn) {
        return null;
      }
      if (!permitted) {
        throw new Error('Foreground microphone permission denied.');
      }
      unsubscribe = this.adapter.subscribePartial(partial => {
        if (this.current === turn && !turn.cancelled && partial.requestId === turn.id) {
          onPartial?.(partial.text);
        }
      });
      turn.started = true;
      const result = await this.adapter.recognize(locale, turn.id);
      return turn.cancelled || this.current !== turn ? null : result;
    } catch (error) {
      // Native startup may not have reached onReadyForSpeech when released.
      // Its explicit cancellation is not a successful transcript.
      const code = (error as {code?: string} | null)?.code;
      if (turn.cancelled || (turn.released && code === 'BUSHMESH_STT_CANCELLED')) {
        return null;
      }
      throw error;
    } finally {
      unsubscribe?.();
      if (this.current === turn) {
        this.current = null;
      }
    }
  }

  async release(): Promise<boolean> {
    const turn = this.current;
    if (!turn || turn.released || turn.cancelled) {
      return false;
    }
    turn.released = true;
    if (!turn.started) {
      turn.cancelled = true;
      return true;
    }
    return this.adapter.finish(turn.id, false);
  }

  async cancel(): Promise<boolean> {
    const turn = this.current;
    if (!turn || turn.cancelled) {
      return false;
    }
    turn.cancelled = true;
    return turn.started ? this.adapter.finish(turn.id, true) : true;
  }
}
