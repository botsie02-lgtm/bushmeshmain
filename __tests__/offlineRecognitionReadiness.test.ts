import {downloadFeedback, englishModelChoices, modelLabel} from '../src/speech/offlineRecognitionReadiness';

test('installed English alternatives are selectable without silently switching selected language', () => {
  expect(englishModelChoices({locale:'en-AU', status:'download-required', reason:null,
    installed:['en-NZ','en-US','fr-FR'], pending:['en-AU'], downloadable:['en-GB','EN-us']}, 'en-AU'))
    .toEqual(['en-AU','en-NZ','en-US','en-GB']);
});

test('provider outcomes never imply installed readiness', () => {
  expect(downloadFeedback('completed')).toContain('Rechecking');
  expect(downloadFeedback('scheduled')).toContain('scheduled');
  expect(downloadFeedback('interrupted')).toContain('may continue');
  expect(downloadFeedback('failed:15')).toContain('provider code 15');
  expect(modelLabel('pending')).toBe('download pending');
  expect(modelLabel('unknown')).toContain('unknown');
  expect(modelLabel('unsupported')).toContain('not supported');
});
