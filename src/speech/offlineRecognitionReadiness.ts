import type {OfflineLanguageInventory} from '../native/NativeSpeechRecognition';

export function modelLabel(status: OfflineLanguageInventory['status']): string {
  switch (status) {
    case 'installed': return 'reported installed';
    case 'pending': return 'download pending';
    case 'download-required': return 'download required';
    case 'unsupported': return 'not supported by this provider';
    default: return 'readiness unknown; test locally';
  }
}

export function englishModelChoices(inventory: OfflineLanguageInventory | null, selected: string): string[] {
  const english = (tag: string) => /^en(?:-[a-z0-9]{1,8})*$/i.test(tag) && tag.length <= 35;
  const choices = ['en-AU', ...(inventory?.installed ?? []), ...(inventory?.pending ?? []),
    ...(inventory?.downloadable ?? []), selected, 'en-GB', 'en-US'].filter(english);
  return choices.filter((tag, i) => choices.findIndex(other => other.toLowerCase() === tag.toLowerCase()) === i);
}

export function downloadFeedback(outcome: string): string {
  switch (outcome) {
    case 'completed': return 'Provider reports download complete. Rechecking actual installed readiness.';
    case 'scheduled': return 'Provider scheduled the model. Refresh readiness after it finishes.';
    case 'requested': return 'Download requested. This Android version does not report progress. Refresh readiness.';
    case 'interrupted': return 'Stopped observing download. The provider may continue; refresh readiness.';
    case 'unconfirmed': return 'Download outcome unconfirmed. Refresh readiness; provider may still be downloading.';
    case 'unavailable': return 'Download unavailable or voice busy. Stop speech, check Android version and retry.';
    default: return 'Model download failed' + (outcome.startsWith('failed:') ? ' (provider code ' + outcome.slice(7) + ')' : '') + '. Check internet and refresh readiness.';
  }
}
