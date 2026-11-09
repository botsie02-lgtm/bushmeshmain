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
  ActiveConvoySelectionStore,
  AuthorizedConvoyDirectory,
  AuthorizedConvoyMembership,
  listSelectableConvoys,
  resolveConvoySelection,
  restoreActiveConvoy,
  selectionFor,
  unavailableConvoyDirectory,
} from './operationalConvoy';
import {platformActiveConvoySelectionStore} from './selectionStore';

type RestoreStatus = 'checking' | 'ready' | 'error';

export type ActiveOperationalConvoyContextValue = {
  /** Null is the only safe default. Not derived from MeshCore channels/contacts. */
  activeConvoy: AuthorizedConvoyMembership | null;
  selectableConvoys: readonly AuthorizedConvoyMembership[];
  status: RestoreStatus;
  notice: string | null;
  localIdentityRef: string | null;
  selectionDurable: boolean;
  selectConvoy: (convoyId: string) => Promise<boolean>;
  clearActiveConvoy: () => Promise<void>;
  refresh: () => Promise<void>;
};

const ActiveOperationalConvoyContext =
  createContext<ActiveOperationalConvoyContextValue | null>(null);

export type ActiveOperationalConvoyProviderProps = {
  children: React.ReactNode;
  localIdentityRef: string | null;
  /**
   * MUST be backed by authenticated Security v1 membership records.
   * Carrier provisioning, channel PSKs and contact discovery MUST NOT be used.
   */
  directory?: AuthorizedConvoyDirectory;
  store?: ActiveConvoySelectionStore;
};

export function ActiveOperationalConvoyProvider({
  children,
  localIdentityRef,
  directory = unavailableConvoyDirectory,
  store = platformActiveConvoySelectionStore,
}: ActiveOperationalConvoyProviderProps): React.JSX.Element {
  const [active, setActive] = useState<AuthorizedConvoyMembership | null>(null);
  const [candidates, setCandidates] = useState<AuthorizedConvoyMembership[]>([]);
  const [status, setStatus] = useState<RestoreStatus>('checking');
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const identityRef = useRef(localIdentityRef);
  identityRef.current = localIdentityRef;

  const refresh = useCallback(async () => {
    const token = ++generation.current;
    setActive(null);
    setCandidates([]);
    setStatus('checking');
    setNotice(null);

    try {
      const [restored, selectable] = await Promise.all([
        restoreActiveConvoy(store, directory, localIdentityRef),
        listSelectableConvoys(directory, localIdentityRef),
      ]);
      if (token !== generation.current || identityRef.current !== localIdentityRef) {
        return;
      }
      setActive(restored);
      setCandidates(selectable);
      setStatus('ready');
    } catch {
      if (token !== generation.current || identityRef.current !== localIdentityRef) {
        return;
      }
      setActive(null);
      setCandidates([]);
      setStatus('error');
      setNotice('Convoy membership could not be validated. No active convoy.');
    }
  }, [directory, localIdentityRef, store]);

  useEffect(() => {
    refresh().catch(() => undefined);
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!directory.subscribeInvalidations) {
      return;
    }
    return directory.subscribeInvalidations(() => {
      refresh().catch(() => undefined);
    });
  }, [directory, refresh]);

  const selectConvoy = useCallback(
    async (convoyId: string): Promise<boolean> => {
      const token = ++generation.current;
      setStatus('checking');
      setNotice(null);
      try {
        // Selection always resolves against live authorization, not the list,
        // saved state, radio channel or displayed contacts.
        const verified = await resolveConvoySelection(
          convoyId,
          localIdentityRef,
          directory,
        );
        if (token !== generation.current || identityRef.current !== localIdentityRef) {
          return false;
        }
        if (!verified) {
          // A failed selection must not silently restore an older choice on
          // the next launch.
          await store.clear().catch(() => undefined);
          if (token !== generation.current || identityRef.current !== localIdentityRef) {
            return false;
          }
          setActive(null);
          setStatus('ready');
          setNotice('No authenticated membership for this convoy.');
          return false;
        }
        try {
          await store.save(selectionFor(verified));
        } catch {
          // The live verified membership can still be selected this session;
          // never report durability when the write did not succeed.
          if (token === generation.current) {
            setNotice('Convoy selected for this session; restore storage unavailable.');
          }
        }
        if (token !== generation.current || identityRef.current !== localIdentityRef) {
          return false;
        }
        setActive(verified);
        setStatus('ready');
        return true;
      } catch {
        if (token === generation.current) {
          setActive(null);
          setStatus('error');
          setNotice('Convoy membership verification failed. No active convoy.');
        }
        return false;
      }
    },
    [directory, localIdentityRef, store],
  );

  const clearActiveConvoy = useCallback(async () => {
    ++generation.current;
    setActive(null);
    setStatus('ready');
    setNotice(null);
    try {
      await store.clear();
    } catch {
      setNotice('Convoy deactivated, but saved selection could not be cleared.');
    }
  }, [store]);

  // Never expose an old identity's authorization during a radio identity swap.
  const safeActive = status === 'ready' &&
    active?.localIdentityRef === localIdentityRef ? active : null;

  const value = useMemo<ActiveOperationalConvoyContextValue>(() => ({
    activeConvoy: safeActive,
    selectableConvoys: candidates,
    status,
    notice,
    localIdentityRef,
    selectionDurable: store.isDurable(),
    selectConvoy,
    clearActiveConvoy,
    refresh,
  }), [
    safeActive,
    candidates,
    status,
    notice,
    localIdentityRef,
    store,
    selectConvoy,
    clearActiveConvoy,
    refresh,
  ]);

  return (
    <ActiveOperationalConvoyContext.Provider value={value}>
      {children}
    </ActiveOperationalConvoyContext.Provider>
  );
}

export function useActiveOperationalConvoy(): ActiveOperationalConvoyContextValue {
  const value = useContext(ActiveOperationalConvoyContext);
  if (!value) {
    throw new Error('useActiveOperationalConvoy requires its provider');
  }
  return value;
}
