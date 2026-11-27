import {createContext, useContext} from 'react';

export type RadioMessagingNavigation = {
  openMessagingSettings: () => void;
  /** Direct entry from the composer; Back returns to the retained room. */
  openVoiceReadiness?: () => void;
  closeMessagingSettings: () => void;
};

export const RadioMessagingNavigationContext =
  createContext<RadioMessagingNavigation | null>(null);

/** Inbox/room components can consume this navigation-only contract without
 * changing carrier selection, conversation state or service ownership. */
export function useRadioMessagingNavigation(): RadioMessagingNavigation {
  const navigation = useContext(RadioMessagingNavigationContext);
  if (!navigation) {
    throw new Error('Radio messaging navigation requires AppShell');
  }
  return navigation;
}
