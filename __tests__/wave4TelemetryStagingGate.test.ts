import {VerifiedConvoyTelemetry} from '../src/convoy/verifiedTelemetry';

describe('Wave 4 telemetry staging remains inert without production adapters', () => {
  it('cannot queue or display a remote position without verified authority', async () => {
    const service = new VerifiedConvoyTelemetry();
    expect(await service.publish(
      {providerId: 'android-gps', fix: null},
      {channelIndex: 4, dataType: 1, transport: 'meshcore'},
    )).toEqual({
      status: 'suppressed',
      reason: 'verified-security-or-runtime-unavailable',
    });
    expect(await service.project()).toBeNull();
    expect(await service.restore()).toBe(false);
    service.dispose();
  });
});
