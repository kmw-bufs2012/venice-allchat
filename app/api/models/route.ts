import { NextResponse } from "next/server";
import { koreanDescription } from "@/lib/model-descriptions";
import { translateToKorean, veniceFetch, type TextModelInfo, type VeniceTextModel } from "@/lib/venice";

export const runtime = "nodejs";

/**
 * Server-side translation cache: { englishText -> koreanText }. Module-scope,
 * so it survives between invocations of a warm serverless instance and cuts
 * translation to roughly one LLM call per cold start (≈$0.003).
 */
const translationCache = new Map<string, string>();
const TRANSLATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const translationCacheAt = { value: 0 };

interface VeniceModelsResponse {
  data?: VeniceTextModel[];
}

/**
 * Serves the live list of ALL Venice text/chat models (uncensored included).
 * The `uncensored` flag comes from Venice's own model traits so the UI can
 * badge them — the API key owner decides what is actually reachable.
 */
export async function GET() {
  try {
    const body = await veniceFetch<VeniceModelsResponse>("/models?type=text", {});
    const models: TextModelInfo[] = (body.data ?? []).map((m) => {
      const spec = m.model_spec;
      const englishDescription = spec?.description ?? m.description ?? "";
      return {
        id: m.id,
        name: spec?.name ?? m.name ?? m.id,
        description: koreanDescription(m.id, englishDescription),
        descriptionEn: englishDescription,
        traits: spec?.traits ?? [],
        contextWindow: spec?.availableContextTokens ?? m.availableContextWindow ?? m.context_length ?? null,
        // Venice exposes uncensored status as a dedicated boolean field
        // (checked at both levels for API-version tolerance) — it is NOT a trait.
        uncensored: spec?.uncensored === true || m.uncensored === true,
      };
    });

    // Real-time translation: anything not already covered by the cache goes
    // to ONE batched Venice call. On failure the pattern-based Korean (or
    // English) fallback already baked into `description` stays in place.
    const cacheFresh = Date.now() - translationCacheAt.value < TRANSLATION_CACHE_TTL_MS;
    if (!cacheFresh) {
      const toTranslate = [...new Set(models.map((m) => m.descriptionEn).filter((d): d is string => !!d))];
      const translated = await translateToKorean(
        toTranslate,
        models.map((m) => ({ id: m.id, traits: m.traits })),
      );
      if (translated) {
        toTranslate.forEach((en, i) => translationCache.set(en, translated[i] ?? en));
        translationCacheAt.value = Date.now();
      }
    }
    for (const m of models) {
      if (m.descriptionEn && translationCache.has(m.descriptionEn)) {
        m.description = translationCache.get(m.descriptionEn) as string;
      }
    }

    models.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ source: "live", models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ source: "error", models: [], error: message }, { status: 502 });
  }
}
