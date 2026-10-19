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
  if (/\bcheckpoint\b/.test(text)) {
    return SemanticDestination.Checkpoint;
  }
  if (/\b(base|base camp)\b/.test(text)) {
    return SemanticDestination.Base;
  }
  if (/\b(water source|water point)\b/.test(text)) {
    return SemanticDestination.WaterSource;
  }
  if (/\b(track|trail)\b/.test(text)) {
    return SemanticDestination.Track;
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
  const destination = findDestination(normalized);
  const etaMinutes = findEtaMinutes(normalized);

  if (/^(yes|yep|yeah|affirmative|copy|received)$/.test(normalized)) {
    return {intent: SemanticIntent.Yes};
  }
  if (/^(no|nope|negative)$/.test(normalized)) {
    return {intent: SemanticIntent.No};
  }
  if (/^(wait|wait there|stand by)$/.test(normalized)) {
    return {intent: SemanticIntent.Wait, destination};
  }
  if (/^(stop|stop now)$/.test(normalized)) {
    return {intent: SemanticIntent.Stop};
  }
  if (/^(continue|keep going|proceed)$/.test(normalized)) {
    return {intent: SemanticIntent.Continue};
  }
  if (/^(i am lost|i'm lost|lost)$/.test(normalized)) {
    return {intent: SemanticIntent.Lost};
  }
  if (/^(i am safe|i'm safe|safe)$/.test(normalized)) {
    return {intent: SemanticIntent.Safe};
  }
  if (/^(need water|i need water|water needed)$/.test(normalized)) {
    return {intent: SemanticIntent.NeedWater};
  }
  if (/^(need fuel|out of fuel|low fuel|fuel needed)$/.test(normalized)) {
    return {intent: SemanticIntent.NeedFuel};
  }
  if (/^(need food|food needed)$/.test(normalized)) {
    return {intent: SemanticIntent.NeedFood};
  }
  if (/^(need tools|tools needed)$/.test(normalized)) {
    return {intent: SemanticIntent.NeedTools};
  }
  if (/^(low battery|battery low)$/.test(normalized)) {
    return {intent: SemanticIntent.LowBattery};
  }
  if (/^(turn around|turn back)$/.test(normalized)) {
    return {intent: SemanticIntent.TurnAround};
  }
  if (/^(hold position|stay there|stay put)$/.test(normalized)) {
    return {intent: SemanticIntent.HoldPosition};
  }
  if (/^(check in|radio check|status check)$/.test(normalized)) {
    return {intent: SemanticIntent.CheckIn};
  }
  if (
    /^(vehicle problem|car problem|vehicle trouble|car trouble|truck trouble)$/.test(
      normalized,
    )
  ) {
    return {intent: SemanticIntent.VehicleProblem};
  }
  if (/^(need recovery|need vehicle recovery|stuck|bogged)$/.test(normalized)) {
    return {intent: SemanticIntent.NeedRecovery};
  }
  if (/^(road blocked|track blocked|route blocked)$/.test(normalized)) {
    return {intent: SemanticIntent.RoadBlocked, destination};
  }
  if (/^(fire|fire reported|bushfire)$/.test(normalized)) {
    return {intent: SemanticIntent.Fire, destination};
  }
  if (/^(flood|flooding|flooded)$/.test(normalized)) {
    return {intent: SemanticIntent.Flood, destination};
  }
  if (/^(injury|injured|someone is injured)$/.test(normalized)) {
    return {intent: SemanticIntent.Injury};
  }
  if (/^(medical|medical help|need medical help|medical assistance)/.test(normalized)) {
    return {intent: SemanticIntent.Medical, destination};
  }
  if (/^(help|need help|i need help)(\b| )/.test(`${normalized} `)) {
    return {intent: SemanticIntent.Help, destination, etaMinutes};
  }
  if (/^(delayed|running late|we are delayed|i am delayed)/.test(normalized)) {
    return {intent: SemanticIntent.Delayed, etaMinutes};
  }
  if (
    destination !== undefined &&
    /^(heading back|heading back to|returning|returning to|going back|going back to)/.test(
      normalized,
    )
  ) {
    return {intent: SemanticIntent.Returning, destination, etaMinutes};
  }
  if (
    destination !== undefined &&
    /^(arrived|arrived at|i arrived|i am at|i'm at)/.test(normalized)
  ) {
    return {intent: SemanticIntent.Arrived, destination};
  }
  if (
    destination !== undefined &&
    /^(meet|meet at|meet me at|rendezvous at)/.test(normalized)
  ) {
    return {intent: SemanticIntent.MeetAt, destination, etaMinutes};
  }
  if (
    destination !== undefined &&
    /^(departing|leaving|heading to|heading for)/.test(normalized)
  ) {
    return {intent: SemanticIntent.Departing, destination, etaMinutes};
  }
  if (
    destination !== undefined &&
    /^(moving|moving to|moving toward|moving towards)/.test(normalized)
  ) {
    return {intent: SemanticIntent.Moving, destination, etaMinutes};
  }

  return null;
}
