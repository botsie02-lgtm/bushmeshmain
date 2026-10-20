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
  state: 'queued' | 'inflight' | 'blocked' | 'accepted';
};

export type NativeCarMessagingStatus = {
  notificationsEnabled: boolean;
  queuedReplies: number;
  inflightReplies: number;
  blockedReplies: number;
  acceptedReplies: number;
};

type NativeCarMessagingModule = {
  postIncomingChannelMessage: (
    channelIndex: number,
    channelName: string,
    senderLabel: string | null,
    text: string,
    timestampMs: number,
  ) => Promise<boolean>;
  setChannelDirectoryJson: (json: string) => Promise<boolean>;
  getPendingReplies: (maxEntries: number) => Promise<NativeCarReply[]>;
  acknowledgeReply: (id: string) => Promise<boolean>;
  markReplyAttempt: (id: string) => Promise<boolean>;
  requeueReplyAfterFailure: (
    id: string,
    errorMessage: string,
  ) => Promise<boolean>;
  markReplyBlocked: (id: string, reason: string) => Promise<boolean>;
  markReplyAccepted: (id: string) => Promise<boolean>;
  getStatus: () => Promise<NativeCarMessagingStatus>;
};

const module = NativeModules.BushMeshCarMessaging as
  | NativeCarMessagingModule
  | undefined;

const unsupportedStatus: NativeCarMessagingStatus = {
  notificationsEnabled: false,
  queuedReplies: 0,
  inflightReplies: 0,
  blockedReplies: 0,
  acceptedReplies: 0,
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

  async setChannelDirectory(
    channels: Array<{channelIndex: string; channelName: string}>,
  ): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }

    const directory: Record<string, string> = {};
    channels.forEach(channel => {
      const index = Number(channel.channelIndex);
      const name = channel.channelName.trim();
      if (
        Number.isInteger(index) &&
        index >= 0 &&
        index <= 7 &&
        name.length > 0 &&
        name.toLowerCase() !== 'empty'
      ) {
        directory[String(index)] = name;
      }
    });

    return module.setChannelDirectoryJson(JSON.stringify(directory));
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

  async markReplyAttempt(id: string): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.markReplyAttempt(id);
  },

  async requeueReplyAfterFailure(
    id: string,
    errorMessage: string,
  ): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.requeueReplyAfterFailure(id, errorMessage);
  },

  async markReplyBlocked(id: string, reason: string): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.markReplyBlocked(id, reason);
  },

  async markReplyAccepted(id: string): Promise<boolean> {
    if (!this.isSupported() || !module) {
      return false;
    }
    return module.markReplyAccepted(id);
  },

  async getStatus(): Promise<NativeCarMessagingStatus> {
    if (!this.isSupported() || !module) {
      return {...unsupportedStatus};
    }
    return module.getStatus();
  },
};