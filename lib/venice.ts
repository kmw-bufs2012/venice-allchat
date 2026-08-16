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
