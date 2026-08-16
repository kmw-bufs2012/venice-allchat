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
 * Translates a batch of short strings to Korean in ONE chat call using the
 * cheapest available model. ~4k tokens per refresh at llama-3.2-3b pricing
 * (≈$0.003); callers cache the result, so this runs about once a day.
 * Returns null on any failure so callers fall back to static translations.
 */
export async function translateToKorean(
  texts: string[],
  candidateModels: { id: string; traits: string[] }[],
): Promise<string[] | null> {
  if (texts.length === 0) return [];

  const translator =
    candidateModels.find((m) => m.traits.includes("fastest")) ??
    candidateModels.find((m) => /llama-3\.(2-3b|1-8b)|gemma|phi|(^|-)(3b|7b|8b)(-|$)/i.test(m.id)) ??
    candidateModels[0];
  if (!translator) return null;

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireVeniceKey()}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
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
          { role: "user", content: JSON.stringify(texts) },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    let content = body.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    content = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length === texts.length && parsed.every((s) => typeof s === "string")) {
      return parsed as string[];
    }
    return null;
  } catch {
    return null;
  }
}
