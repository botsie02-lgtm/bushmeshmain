import {projectExplicitChannelMarkers} from '../src/convoy/fieldLocation/mapProjection';
import type {UnverifiedChannelRemotePosition} from '../src/convoy/fieldLocation/ChannelFieldLocationSession';

const now = 1800000000000;
const marker: UnverifiedChannelRemotePosition = {
  kind: 'UNVERIFIED CHANNEL POSITION', channelIndex: 4, claimedLabel: 'CarA',
  claimedSession: 'claimed', transportSourceDeviceId: null,
  sourceAuthentication: 'none-channel-key-only', latitude: -37.8, longitude: 144.9,
  receivedAtMs: now - 1000, claimedFixTimeMs: now - 2000,
  expiresAtMs: now + 5000, freshness: 'recent',
};
test('explicit channel observations project only as unverified diagnostics and expire', () => {
  const result = projectExplicitChannelMarkers([marker], now);
  expect(result).toEqual([{
    id: 'channel-field:4:claimed', label: 'CHANNEL · CarA',
    coordinate: {latitude: -37.8, longitude: 144.9}, receivedAtMs: now - 1000,
    accuracyMeters: null, simulated: false, trust: 'unverified-channel',
  }]);
  expect(projectExplicitChannelMarkers([marker], now + 6000)).toEqual([]);
  expect(projectExplicitChannelMarkers([{...marker, latitude: 91}], now)).toEqual([]);
});
