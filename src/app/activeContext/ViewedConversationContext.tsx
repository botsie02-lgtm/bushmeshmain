import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';

/**
 * Navigation-only conversation selection. It is NOT a MeshCore carrier channel
 * setting and NOT a Security v1 membership or trust decision.
 *
 * The existing RadioScreen currently follows the carrier channel; a future
 * Radio/Contacts worker can use this contract for dedicated conversations.
 */
export type ViewedConversationRef =
  | {kind: 'meshcore-channel'; channelIndex: string}
  | {kind: 'direct-peer'; peerIdentityRef: string}
  | {kind: 'operational-convoy'; convoyId: string};

type ViewedConversationContextValue = {
  viewedConversation: ViewedConversationRef | null;
  setViewedConversation: (selection: ViewedConversationRef | null) => void;
};

const ViewedConversationContext = createContext<ViewedConversationContextValue | null>(null);

function safeRef(value: string): boolean {
  return value.length > 0 && value.length <= 128 &&
    /^[a-zA-Z0-9_.:-]+$/.test(value);
}

export function sanitizeConversationSelection(
  value: ViewedConversationRef | null,
): ViewedConversationRef | null {
  if (value === null) {
    return null;
  }
  if (value.kind === 'meshcore-channel' && safeRef(value.channelIndex)) {
    return {kind: value.kind, channelIndex: value.channelIndex};
  }
  if (value.kind === 'direct-peer' && safeRef(value.peerIdentityRef)) {
    return {kind: value.kind, peerIdentityRef: value.peerIdentityRef};
  }
  if (value.kind === 'operational-convoy' && safeRef(value.convoyId)) {
    return {kind: value.kind, convoyId: value.convoyId};
  }
  throw new Error('Invalid conversation reference.');
}

export function ViewedConversationProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [viewedConversation, setSelection] = useState<ViewedConversationRef | null>(null);
  const setViewedConversation = useCallback((value: ViewedConversationRef | null) => {
    // Construct only known fields, so a caller cannot accidentally put
    // carrier PSKs, private messages or cryptographic keys into navigation state.
    setSelection(sanitizeConversationSelection(value));
  }, []);
  const context = useMemo(() => ({
    viewedConversation,
    setViewedConversation,
  }), [viewedConversation, setViewedConversation]);
  return (
    <ViewedConversationContext.Provider value={context}>
      {children}
    </ViewedConversationContext.Provider>
  );
}

export function useViewedConversation(): ViewedConversationContextValue {
  const value = useContext(ViewedConversationContext);
  if (!value) {
    throw new Error('useViewedConversation requires its provider');
  }
  return value;
}
