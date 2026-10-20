import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  NativeCarMessagingStatus,
  nativeCarMessaging,
} from '../native/NativeCarMessaging';
import {useBushMesh} from './BushMeshContext';

type CarMessagingContextValue = {
  supported: boolean;
  status: NativeCarMessagingStatus;
  errorMessage: string | null;
  draining: boolean;
  refresh: () => Promise<void>;
};

const CarMessagingContext = createContext<CarMessagingContextValue | null>(null);
const POLL_INTERVAL_MS = 2_000;
const MAX_REPLIES_PER_DRAIN = 4;
const MESHCORE_TEXT_LIMIT = 133;

const initialStatus: NativeCarMessagingStatus = {
  notificationsEnabled: false,
  queuedReplies: 0,
  inflightReplies: 0,
  blockedReplies: 0,
  acceptedReplies: 0,
};

function retryDelayMs(attempts: number): number {
  if (attempts <= 0) {
    return 0;
  }
  return Math.min(60_000, 2_000 * 2 ** Math.min(5, attempts - 1));
}

export function CarMessagingProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {
    canSendChannelMessage,
    sendChannelMessage,
    addLocalChannelMessage,
  } = useBushMesh();
  const supported = nativeCarMessaging.isSupported();
  const [status, setStatus] = useState<NativeCarMessagingStatus>(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draining, setDraining] = useState(false);
  const drainActiveRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!supported) {
      setStatus(initialStatus);
      setErrorMessage(null);
      return;
    }

    try {
      setStatus(await nativeCarMessaging.getStatus());
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Android Auto messaging status could not be read.',
      );
    }
  }, [supported]);

  const drainReplies = useCallback(async () => {
    if (
      !supported ||
      !canSendChannelMessage ||
      drainActiveRef.current
    ) {
      return;
    }

    drainActiveRef.current = true;
    setDraining(true);
    try {
      const replies = await nativeCarMessaging.getPendingReplies(
        MAX_REPLIES_PER_DRAIN,
      );
      const nowMs = Date.now();

      for (const reply of replies) {
        const text = reply.text.trim();
        if (!text) {
          await nativeCarMessaging.markReplyBlocked(
            reply.id,
            'Android Auto reply contained no text.',
          );
          continue;
        }

        if (text.length > MESHCORE_TEXT_LIMIT) {
          await nativeCarMessaging.markReplyBlocked(
            reply.id,
            `Voice reply is ${text.length} characters; MeshCore channel text is limited to ${MESHCORE_TEXT_LIMIT}. Open Bushmesh to edit it before sending.`,
          );
          continue;
        }

        const nextAttemptAtMs =
          (reply.lastAttemptAtMs ?? 0) + retryDelayMs(reply.attempts);
        if (nextAttemptAtMs > nowMs) {
          continue;
        }

        const attemptPersisted = await nativeCarMessaging.markReplyAttempt(
          reply.id,
        );
        if (!attemptPersisted) {
          continue;
        }

        try {
          await sendChannelMessage(reply.channelIndex, text);

          // Persist terminal radio acceptance before touching history or
          // deleting the queue entry. A crash from this point onward cannot
          // cause an automatic duplicate radio transmission.
          const acceptedPersisted = await nativeCarMessaging.markReplyAccepted(
            reply.id,
          );
          if (!acceptedPersisted) {
            setErrorMessage(
              'A car voice reply was accepted by MeshCore, but its durable accepted state could not be recorded. Bushmesh will not retry that uncertain entry automatically.',
            );
            continue;
          }

          addLocalChannelMessage({
            channelIndex: String(reply.channelIndex),
            channelName:
              reply.channelName.trim() || `Channel ${reply.channelIndex}`,
            text,
            direction: 'sent',
            status: 'accepted',
          });

          // Cleanup is deliberately last. If it fails, the retained entry is
          // still terminal ACCEPTED and therefore cannot be transmitted again.
          await nativeCarMessaging.acknowledgeReply(reply.id);
        } catch (error) {
          const detail =
            error instanceof Error
              ? error.message
              : 'MeshCore rejected the Android Auto reply.';
          const requeued = await nativeCarMessaging.requeueReplyAfterFailure(
            reply.id,
            detail,
          );
          if (!requeued) {
            setErrorMessage(
              'A car voice reply failed while its durable state was in-flight. It has been left uncertain rather than automatically retransmitted.',
            );
          }
        }
      }

      setStatus(await nativeCarMessaging.getStatus());
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Android Auto voice replies could not be processed.',
      );
    } finally {
      drainActiveRef.current = false;
      setDraining(false);
    }
  }, [
    addLocalChannelMessage,
    canSendChannelMessage,
    sendChannelMessage,
    supported,
  ]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!supported) {
      return;
    }

    const timer = setInterval(() => {
      refresh().catch(() => undefined);
      if (canSendChannelMessage) {
        drainReplies().catch(() => undefined);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [canSendChannelMessage, drainReplies, refresh, supported]);

  useEffect(() => {
    if (canSendChannelMessage) {
      drainReplies().catch(() => undefined);
    }
  }, [canSendChannelMessage, drainReplies]);

  const value = useMemo<CarMessagingContextValue>(
    () => ({
      supported,
      status,
      errorMessage,
      draining,
      refresh,
    }),
    [supported, status, errorMessage, draining, refresh],
  );

  return (
    <CarMessagingContext.Provider value={value}>
      {children}
    </CarMessagingContext.Provider>
  );
}

export function useCarMessaging(): CarMessagingContextValue {
  const context = useContext(CarMessagingContext);
  if (!context) {
    throw new Error('useCarMessaging must be used inside CarMessagingProvider');
  }
  return context;
}
