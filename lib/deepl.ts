/**
 * DeepL translation for model descriptions.
 *
 * Unlike an LLM, DeepL translates the FULL original text verbatim — no
 * abridging. Free keys (ending in ":fx") hit api-free.deepl.com; Pro keys hit
 * api.deepl.com. DeepL accepts up to 50 texts per request, so large model
 * lists are chunked; failed chunks keep the English original.
 */

const FREE_HOST = "https://api-free.deepl.com/v2/translate";
const PRO_HOST = "https://api.deepl.com/v2/translate";

export function deepLConfigured(): boolean {
  return !!process.env.DEEPL_API_KEY;
}

export async function translateWithDeepL(texts: string[]): Promise<(string | null)[]> {
  const key = process.env.DEEPL_API_KEY;
  if (!key || texts.length === 0) return texts.map(() => null);

  const host = key.trim().endsWith(":fx") ? FREE_HOST : PRO_HOST;
  const results: (string | null)[] = texts.map(() => null);
  const CHUNK = 50; // DeepL caps a request at 50 texts

  for (let start = 0; start < texts.length; start += CHUNK) {
    const chunk = texts.slice(start, start + CHUNK);
    try {
      const res = await fetch(host, {
        method: "POST",
        headers: {
          Authorization: `DeepL-Auth-Key ${key}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ text: chunk, source_lang: "EN", target_lang: "KO" }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { translations?: { text?: string }[] };
      const translations = body.translations ?? [];
      chunk.forEach((_, i) => {
        const t = translations[i]?.text;
        if (typeof t === "string") results[start + i] = t;
      });
    } catch {
      // failed chunk stays null → caller keeps the English original
    }
  }
  return results;
}
