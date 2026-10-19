import {BUSHMESH_TEXT_DICTIONARY} from './textDictionary';

export type BushMeshDictionaryCandidate = {
  phrase: string;
  count: number;
  estimatedSavingsPerUse: number;
  estimatedTotalSavings: number;
};

export type BushMeshDictionaryStatsSnapshot = {
  version: 1;
  counts: Array<[string, number]>;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export class BushMeshDictionaryLearner {
  private readonly counts = new Map<string, number>();

  observe(text: string): void {
    const words = tokenize(text);
    for (let width = 1; width <= 3; width += 1) {
      for (let index = 0; index + width <= words.length; index += 1) {
        const phrase = words.slice(index, index + width).join(' ');
        if (phrase.length < 3) {
          continue;
        }
        this.counts.set(phrase, (this.counts.get(phrase) ?? 0) + 1);
      }
    }
  }

  observeMany(texts: string[]): void {
    texts.forEach(text => this.observe(text));
  }

  candidates(
    options?: {minimumCount?: number; limit?: number},
  ): BushMeshDictionaryCandidate[] {
    const minimumCount = options?.minimumCount ?? 3;
    const limit = options?.limit ?? 25;
    const existing = new Set(
      BUSHMESH_TEXT_DICTIONARY.map(entry => entry.trim().toLowerCase()).filter(Boolean),
    );

    return Array.from(this.counts.entries())
      .filter(([phrase, count]) => count >= minimumCount && !existing.has(phrase))
      .map(([phrase, count]) => {
        const estimatedSavingsPerUse = Math.max(0, phrase.length - 1);
        return {
          phrase,
          count,
          estimatedSavingsPerUse,
          estimatedTotalSavings: estimatedSavingsPerUse * count,
        };
      })
      .filter(candidate => candidate.estimatedSavingsPerUse > 0)
      .sort(
        (a, b) =>
          b.estimatedTotalSavings - a.estimatedTotalSavings ||
          b.count - a.count ||
          a.phrase.localeCompare(b.phrase),
      )
      .slice(0, limit);
  }

  snapshot(): BushMeshDictionaryStatsSnapshot {
    return {
      version: 1,
      counts: Array.from(this.counts.entries()).sort((a, b) =>
        a[0].localeCompare(b[0]),
      ),
    };
  }

  restore(snapshot: BushMeshDictionaryStatsSnapshot): void {
    if (snapshot.version !== 1 || !Array.isArray(snapshot.counts)) {
      throw new Error('Unsupported dictionary learner snapshot.');
    }

    this.counts.clear();
    for (const [phrase, count] of snapshot.counts) {
      if (!phrase || !Number.isInteger(count) || count < 1) {
        throw new Error('Dictionary learner snapshot contains invalid data.');
      }
      this.counts.set(phrase, count);
    }
  }

  clear(): void {
    this.counts.clear();
  }
}
