import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {BUSHMESH_FORMATION_MESSAGE_TYPE} from '../bushmesh/formationProtocol';
import {subscribeBushMeshInboundMessages} from '../bushmesh/inboundBus';
import {compareBushMeshPacketClock} from '../bushmesh/replayGuard';
import {
  BushMeshFormationProposal,
  acceptFormationProposal,
  buildFormationProposal,
} from '../convoy/formationProposal';
import {useConvoyFormation} from './ConvoyFormationContext';
import {useRadioSession} from './RadioSessionContext';

type FormationProposalContextValue = {
  proposals: BushMeshFormationProposal[];
  latestProposal: BushMeshFormationProposal | null;
  acceptProposal: (proposalId: string) => void;
  dismissProposal: (proposalId: string) => void;
  dismissAll: () => void;
};

const FormationProposalContext = createContext<FormationProposalContextValue | null>(
  null,
);
const MAX_FORMATION_PROPOSALS = 8;

export function FormationProposalProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {snapshot: radioSession} = useRadioSession();
  const {applyAcceptedFormationPlan} = useConvoyFormation();
  const [proposals, setProposals] = useState<BushMeshFormationProposal[]>([]);

  useEffect(() => {
    return subscribeBushMeshInboundMessages((message, metadata) => {
      if (message.type !== BUSHMESH_FORMATION_MESSAGE_TYPE) {
        return;
      }

      const localIdentity = radioSession.identityRef;
      if (
        localIdentity !== null &&
        message.formation.senderId.toUpperCase() === localIdentity.toUpperCase()
      ) {
        return;
      }

      const incoming = buildFormationProposal(
        message.formation,
        metadata.receivedAtMs,
        localIdentity,
      );

      setProposals(current => {
        const existing = current.find(
          proposal => proposal.share.senderId === incoming.share.senderId,
        );
        if (existing) {
          const order = compareBushMeshPacketClock(
            {
              timestampSeconds: existing.share.timestampSeconds,
              sequence: existing.share.sequence,
            },
            {
              timestampSeconds: incoming.share.timestampSeconds,
              sequence: incoming.share.sequence,
            },
          );
          if (order !== 'newer') {
            return current;
          }
        }

        const withoutSender = current.filter(
          proposal => proposal.share.senderId !== incoming.share.senderId,
        );
        return [incoming, ...withoutSender].slice(0, MAX_FORMATION_PROPOSALS);
      });
    });
  }, [radioSession.identityRef]);

  const latestProposal = proposals[0] ?? null;

  const acceptProposal = useCallback(
    (proposalId: string) => {
      const proposal = proposals.find(item => item.id === proposalId);
      if (!proposal) {
        throw new Error('Formation proposal is no longer available.');
      }
      if (radioSession.identityRef === null) {
        throw new Error(
          'Bushmesh needs the connected radio identity before accepting a formation.',
        );
      }

      const plan = acceptFormationProposal(
        proposal,
        radioSession.identityRef,
      );
      applyAcceptedFormationPlan(plan);
      setProposals(current => current.filter(item => item.id !== proposalId));
    }, [applyAcceptedFormationPlan, proposals, radioSession.identityRef],
  );

  const dismissProposal = useCallback((proposalId: string) => {
    setProposals(current => current.filter(item => item.id !== proposalId));
  }, []);

  const dismissAll = useCallback(() => {
    setProposals([]);
  }, []);

  const value = useMemo<FormationProposalContextValue>(
    () => ({
      proposals,
      latestProposal,
      acceptProposal,
      dismissProposal,
      dismissAll,
    }),
    [proposals, latestProposal, acceptProposal, dismissProposal, dismissAll],
  );

  return (
    <FormationProposalContext.Provider value={value}>
      {children}
    </FormationProposalContext.Provider>
  );
}

export function useFormationProposals(): FormationProposalContextValue {
  const context = useContext(FormationProposalContext);
  if (!context) {
    throw new Error(
      'useFormationProposals must be used inside FormationProposalProvider',
    );
  }
  return context;
}
