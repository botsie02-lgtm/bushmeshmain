import {
  SemanticDestination,
  SemanticIntent,
  SemanticMessage,
} from './semantic';

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[!?.,]+$/g, '')
    .replace(/\s+/g, ' ');
}

function findDestination(text: string): SemanticDestination | undefined {
  if (/\bcamp\b/.test(text)) {
    return SemanticDestination.Camp;
  }

  if (/\bhome\b/.test(text)) {
    return SemanticDestination.Home;
  }

  if (/\b(vehicle|car|truck)\b/.test(text)) {
    return SemanticDestination.Vehicle;
  }

  if (/\b(rendezvous|meeting point|rally point)\b/.test(text)) {
    return SemanticDestination.Rendezvous;
  }

  return undefined;
}

function findEtaMinutes(text: string): number | undefined {
  const match = text.match(
    /(?:\beta\b|\bin\b|\babout\b|\bapproximately\b)\s*(\d{1,4})\s*(?:min|mins|minute|minutes)?\b/,
  );

  if (!match) {
    return undefined;
  }

  const minutes = Number(match[1]);
  return Number.isInteger(minutes) && minutes >= 0 ? minutes : undefined;
}

export function tryParseSemanticText(text: string): SemanticMessage | null {
  const normalized = normalize(text);

  if (/^(yes|yep|yeah|affirmative)$/.test(normalized)) {
    return {intent: SemanticIntent.Yes};
  }

  if (/^(no|nope|negative)$/.test(normalized)) {
    return {intent: SemanticIntent.No};
  }

  if (/^(need water|i need water|water needed)$/.test(normalized)) {
    return {intent: SemanticIntent.NeedWater};
  }

  if (
    /^(vehicle problem|car problem|vehicle trouble|car trouble|truck trouble)$/.test(
      normalized,
    )
  ) {
    return {intent: SemanticIntent.VehicleProblem};
  }

  const destination = findDestination(normalized);
  const etaMinutes = findEtaMinutes(normalized);

  if (
    /^(medical|medical help|need medical help|medical assistance)/.test(normalized)
  ) {
    return {
      intent: SemanticIntent.Medical,
      destination,
    };
  }

  if (/^(help|need help|i need help)(\b| )/.test(`${normalized} `)) {
    return {
      intent: SemanticIntent.Help,
      destination,
      etaMinutes,
    };
  }

  if (
    destination !== undefined &&
    /^(heading back|heading back to|returning|returning to|going back|going back to)/.test(
      normalized,
    )
  ) {
    return {
      intent: SemanticIntent.Returning,
      destination,
      etaMinutes,
    };
  }

  if (
    destination !== undefined &&
    /^(arrived|arrived at|i arrived|i am at|i'm at)/.test(normalized)
  ) {
    return {
      intent: SemanticIntent.Arrived,
      destination,
    };
  }

  return null;
}
