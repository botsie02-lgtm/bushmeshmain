import {
  SECURE_ENROLMENT_V3_ACTIVATION,
  SecurityV2ContractUnavailable,
} from '../src/convoy/enrolmentV3';
import {unavailableConvoyDirectory} from '../src/app/activeContext/operationalConvoy';

describe('Wave 3 production authorization stays disabled', () => {
  test('Security v2 incremental membership remains unavailable', () => {
    expect(SECURE_ENROLMENT_V3_ACTIVATION).toBe('disabled-pending-security-v2-review');
    expect(new SecurityV2ContractUnavailable()).toMatchObject({
      code: 'SECURITY_V2_CONTRACT_REQUIRED',
    });
  });
  test('unconfigured membership directory cannot manufacture a verified roster', async () => {
    expect(await unavailableConvoyDirectory.listAuthorized('bm1_unconfigured')).toEqual([]);
    expect(await unavailableConvoyDirectory.resolveAuthorized('bmc1_unconfigured', 'bm1_unconfigured')).toBeNull();
  });
});
