import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  bushMeshV1RuntimeService,
  type BushMeshV1RuntimeService,
  type BushMeshV1RuntimeSnapshot,
} from '../integration/BushMeshV1RuntimeService';

type BushMeshV1RuntimeContextValue = {
  service: BushMeshV1RuntimeService;
  snapshot: BushMeshV1RuntimeSnapshot;
};

const BushMeshV1RuntimeContext =
  createContext<BushMeshV1RuntimeContextValue | null>(null);

/** Mounts the canonical runtime once at application-provider lifetime. */
export function BushMeshV1RuntimeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<BushMeshV1RuntimeSnapshot>(() =>
    bushMeshV1RuntimeService.getSnapshot(),
  );

  useEffect(() => {
    const unsubscribe = bushMeshV1RuntimeService.subscribe(setSnapshot);
    void bushMeshV1RuntimeService.start().catch(() => undefined);

    return () => {
      unsubscribe();
      void bushMeshV1RuntimeService.dispose();
    };
  }, []);

  const value = useMemo(
    () => ({service: bushMeshV1RuntimeService, snapshot}),
    [snapshot],
  );

  return (
    <BushMeshV1RuntimeContext.Provider value={value}>
      {children}
    </BushMeshV1RuntimeContext.Provider>
  );
}

export function useBushMeshV1Runtime(): BushMeshV1RuntimeContextValue {
  const value = useContext(BushMeshV1RuntimeContext);
  if (!value) {
    throw new Error(
      'useBushMeshV1Runtime must be used within BushMeshV1RuntimeProvider.',
    );
  }
  return value;
}
