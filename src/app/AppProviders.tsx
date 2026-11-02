import React from 'react';

import {LegacyBushMeshInboundBridge} from '../components/LegacyBushMeshInboundBridge';
import {NativeChannelMessageBridge} from '../components/NativeChannelMessageBridge';
import {PositionRequestResponder} from '../components/PositionRequestResponder';
import {RadioMessageSpeechBridge} from '../components/RadioMessageSpeechBridge';
import {RecoveryCheckpointGuard} from '../components/RecoveryCheckpointGuard';
import {SpeechAlertBridge} from '../components/SpeechAlertBridge';
import {BushMeshProvider} from '../state/BushMeshContext';
import {CarMessagingProvider} from '../state/CarMessagingContext';
import {ConvoyProvider} from '../state/ConvoyContext';
import {ConvoyFormationProvider} from '../state/ConvoyFormationContext';
import {ConvoyRecoveryProvider} from '../state/ConvoyRecoveryContext';
import {DriveProvider} from '../state/DriveContext';
import {FormationProposalProvider} from '../state/FormationProposalContext';
import {LocationSessionProvider} from '../state/LocationSessionContext';
import {OfflineMapProvider} from '../state/OfflineMapContext';
import {RadioSessionProvider} from '../state/RadioSessionContext';
import {RouteSessionProvider} from '../state/RouteSessionContext';
import {SpeechProvider} from '../state/SpeechContext';

/**
 * Owns long-lived application services and provider ordering. App.tsx should
 * remain a shell/navigation surface rather than the place where runtime bridges
 * accumulate as protocol/radio integration grows.
 */
export function AppProviders({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <BushMeshProvider>
      <LegacyBushMeshInboundBridge />
      <NativeChannelMessageBridge />
      <CarMessagingProvider>
        <ConvoyProvider>
          <RecoveryCheckpointGuard />
          <ConvoyFormationProvider>
            <ConvoyRecoveryProvider>
              <DriveProvider>
                <SpeechProvider>
                  <SpeechAlertBridge />
                  <RadioMessageSpeechBridge />
                  <RadioSessionProvider>
                    <FormationProposalProvider>
                      <OfflineMapProvider>
                        <LocationSessionProvider>
                          <RouteSessionProvider>
                            <PositionRequestResponder />
                            {children}
                          </RouteSessionProvider>
                        </LocationSessionProvider>
                      </OfflineMapProvider>
                    </FormationProposalProvider>
                  </RadioSessionProvider>
                </SpeechProvider>
              </DriveProvider>
            </ConvoyRecoveryProvider>
          </ConvoyFormationProvider>
        </ConvoyProvider>
      </CarMessagingProvider>
    </BushMeshProvider>
  );
}
