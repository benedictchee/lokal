import {
  buildExtractionMessages, parseCriticalInfo,
  type CriticalInfo, type ExtractionInput,
} from '@travel/pipeline-core';

export const EXTRACT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Minimal shape of the Workers AI binding we use (keeps the fn testable with a fake). */
interface AiRunner { run(model: string, opts: unknown): Promise<{ response?: string }>; }

/** Extract critical info via the LLM; one stricter retry on parse failure, else null. */
export async function extractCriticalInfo(ai: AiRunner, input: ExtractionInput): Promise<CriticalInfo | null> {
  const messages = buildExtractionMessages(input);
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs = attempt === 0
      ? messages
      : [...messages, { role: 'user' as const, content: 'Output ONLY the JSON object, nothing else.' }];
    const res = await ai.run(EXTRACT_MODEL, { messages: msgs, max_tokens: 700, temperature: 0.1 });
    const parsed = parseCriticalInfo(res.response ?? '');
    if (parsed) return parsed;
  }
  return null;
}
