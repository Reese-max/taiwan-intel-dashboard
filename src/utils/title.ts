import { fold } from "../search-query";

export function titleBigrams(title: string): Set<string> {
  const chars = [...fold(title).replace(/[\s\p{P}\p{S}]/gu, "")];
  return new Set(chars.slice(1).map((char, index) => chars[index] + char));
}

export function titleSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const pair of a) if (b.has(pair)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
