/** Extracted, cross-validated facets about a place. Each is a list of short phrases. */
export interface CriticalInfo {
  specialties: string[];
  atmosphere: string[];
  good_for: string[];
  consistent_praise: string[];
  consistent_complaints: string[];
  practical: string[];
}

export const CRITICAL_INFO_KEYS: (keyof CriticalInfo)[] = [
  'specialties', 'atmosphere', 'good_for',
  'consistent_praise', 'consistent_complaints', 'practical',
];

const MAX_ITEMS_PER_FACET = 8;

export const EMPTY_CRITICAL_INFO: CriticalInfo = {
  specialties: [], atmosphere: [], good_for: [],
  consistent_praise: [], consistent_complaints: [], practical: [],
};

const LABELS: Record<keyof CriticalInfo, string> = {
  specialties: 'Specialties',
  atmosphere: 'Atmosphere',
  good_for: 'Good for',
  consistent_praise: 'Praised for',
  consistent_complaints: 'Complaints',
  practical: 'Practical',
};

/** Deterministic dense serialization for embedding; empty facets are omitted. */
export function serializeCriticalInfo(ci: CriticalInfo): string {
  return CRITICAL_INFO_KEYS
    .filter((k) => ci[k] && ci[k].length > 0)
    .map((k) => `${LABELS[k]}: ${ci[k].join(', ')}.`)
    .join(' ');
}

/** Embedding input for a reviewed place: name + category anchor + serialized facets. */
export function criticalInfoEmbedText(name: string, category: string, ci: CriticalInfo): string {
  return [name, category, serializeCriticalInfo(ci)].map((s) => s.trim()).filter(Boolean).join(' ');
}

export interface ExtractionInput {
  name: string;
  category: string;
  rating: number | null;
  existing?: CriticalInfo;
  reviews: { stars: number | null; text: string }[];
}

export interface ChatMessage { role: 'system' | 'user'; content: string; }

const SYSTEM = `You distill noisy place reviews into trustworthy CRITICAL INFORMATION for a travel search index.
Rules:
- EXTRACT facts/attributes; do NOT write prose or a summary.
- CROSS-VALIDATE: keep a point only if multiple reviews corroborate it, OR it is already in the prior critical information and is not contradicted by the new reviews.
- DENOISE: drop one-off opinions, transient complaints (e.g. "slow today"), generic filler ("nice place"), personal anecdotes, off-topic remarks, and contradicted claims.
- Output ONLY a JSON object with exactly these keys, each an array of short phrases (omit a point rather than guess; use [] when nothing qualifies):
  {"specialties":[],"atmosphere":[],"good_for":[],"consistent_praise":[],"consistent_complaints":[],"practical":[]}`;

export function buildExtractionMessages(input: ExtractionInput): ChatMessage[] {
  const priorLine = input.existing
    ? `Prior critical information (carry forward what new reviews still support):\n${JSON.stringify(input.existing)}\n\n`
    : '';
  const reviewsBlock = input.reviews
    .map((r, i) => `#${i + 1} [${r.stars ?? '?'}★] ${r.text}`)
    .join('\n');
  const user =
    `Place: ${input.name}\nCategory: ${input.category}\nOverall rating: ${input.rating ?? 'n/a'}\n\n` +
    priorLine +
    `New reviews:\n${reviewsBlock}\n\nReturn the JSON object only.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_ITEMS_PER_FACET);
}

/** Parse a model response into CriticalInfo. Tolerates code fences/surrounding prose. Null if no JSON object. */
export function parseCriticalInfo(raw: string): CriticalInfo | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const out = { ...EMPTY_CRITICAL_INFO };
  for (const k of CRITICAL_INFO_KEYS) out[k] = cleanList(obj[k]);
  return out;
}
