import {NativeModules, Platform} from 'react-native';

export type NativeCarReply = {
  id: string;
  channelIndex: number;
  channelName: string;
  text: string;
  createdAtMs: number;
  attempts: number;
  lastAttemptAtMs: number | null;
  lastError: string | null;
  state: 'queued' | 'blocked';
};

export type NativeCarMessagingStatus = {
  notificationsEnabled: boolean;
  queuedReplies: number;
  blockedReplies: number;
};

type NativeCarMessagingModule = {
  postIncomingChannelMessage: (
    channelIndex: number,
    channelName: string,
    senderLabel: string | null,
    text: string,
    timestampMs: number,
  ) => Promise<boolean>;
  getPendingReplies: (maxEntries: number) => Promise<NativeCarReply[]>;
  acknowledgeReply: (id: string) => Promise<boolean>;
  markReplyAttempt: (
    id: string,
    errorMessage: string | null,
  ) => Promise<boolean>;
  markReplyBlocked: (id: string, reason: string) => Promise<boolean>;
  getStatus: () => Promise<NativeCarMessagingStatus>;
};

const module = NativeModules.BushMeshCarMessaging as
  | NativeCarMessagingModule
  | undefined;

const unsupportedStatus: NativeCarMessagingStatus = {
  notificationsEnabled: false,
  queuedReplies: 0,
  blockedReplies: 0,
};

export const nativeCarMessaging = {
  isSupported(): boolean {
    return Platform.OS === 'android' && module !== undefined;
  },

  async postIncomingChannelMessage(input: {
    channelIndex: number;
    channelName: string;
    senderLabel?: string | null;
    text: string;
    timestampMs?: number;
  }): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.postIncomingChannelMessage(
      input.channelIndex,
      input.channelName,
      input.senderLabel ?? null,
      input.text,
      input.timestampMs ?? Date.now(),
    );
  },

  async getPendingReplies(maxEntries = 8): Promise<NativeCarReply[]> {
    if (!this.isSupported() || !module) {
      return [];
    }
    return module.getPendingReplies(maxEntries);
  },

  async acknowledgeReply(id: string): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.acknowledgeReply(id);
  },

  async markReplyAttempt(
    id: string,
    errorMessage: string | null = null,
  ): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.markReplyAttempt(id, errorMessage);
  },

  async markReplyBlocked(id: string, reason: string): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.markReplyBlocked(id, reason);
  },

  async getStatus(): Promise<NativeCarMessagingStatus> {
    if (!this.isSupported() || !module) {
      return {...unsupportedStatus};
    }
    return module.getStatus();
  },
};
