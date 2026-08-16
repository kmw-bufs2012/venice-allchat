const BASE_URL = "https://api.venice.ai/api/v1";

export function requireVeniceKey(): string {
  const key = process.env.VENICE_API_KEY;
  if (!key) throw new Error("VENICE_API_KEY is not configured");
  return key;
}

export async function veniceFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireVeniceKey()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Venice API ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export interface VeniceTextModel {
  id: string;
  name?: string;
  description?: string;
  uncensored?: boolean;
  context_length?: number;
  model_spec?: {
    name?: string;
    description?: string;
    traits?: string[];
    tokenizer?: string;
    uncensored?: boolean;
    availableContextTokens?: number;
  };
  availableContextWindow?: number;
  createdAt?: string;
}

export interface TextModelInfo {
  id: string;
  name: string;
  description: string;
  descriptionEn?: string;
  traits: string[];
  contextWindow: number | null;
  uncensored: boolean;
}

/**
 * Translates short strings to Korean in batched chat calls using the cheapest
 * available model. Large model lists are chunked (30 strings per call) so a
 * big catalog can't blow the context window or a single timeout. Returns a
 * per-input result (null for chunks that failed) so callers keep fallbacks.
 */
export async function translateToKorean(
  texts: string[],
  candidateModels: { id: string; traits: string[] }[],
): Promise<(string | null)[]> {
  if (texts.length === 0) return [];

  const translator =
    candidateModels.find((m) => m.traits.includes("fastest")) ??
    candidateModels.find((m) => /llama-3\.(2-3b|1-8b)|gemma|phi|(^|-)(3b|7b|8b)(-|$)/i.test(m.id)) ??
    candidateModels[0];
  if (!translator) return texts.map(() => null);

  const results: (string | null)[] = texts.map(() => null);
  const CHUNK = 30;
  for (let start = 0; start < texts.length; start += CHUNK) {
    const chunk = texts.slice(start, start + CHUNK);
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireVeniceKey()}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          model: translator.id,
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You are a translator. The user sends a JSON array of short English AI model descriptions. " +
                "Reply with ONLY a JSON array of the same length: natural, concise Korean translations. " +
                "Keep proper nouns (Llama, DeepSeek, Qwen…) as-is. No markdown, no commentary.",
            },
            { role: "user", content: JSON.stringify(chunk) },
          ],
        }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      let content = body.choices?.[0]?.message?.content?.trim();
      if (!content) continue;
      content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length === chunk.length && parsed.every((s) => typeof s === "string")) {
        chunk.forEach((_, i) => {
          results[start + i] = parsed[i] as string;
        });
      }
    } catch {
      // failed chunk stays null → caller keeps the static fallback
    }
  }
  return results;
}
