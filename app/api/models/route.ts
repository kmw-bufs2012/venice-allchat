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
export async function GET(request: Request) {
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

    // Sort first so the translator model pick (inside translateToKorean)
    // sees a stable, name-ordered list.
    models.sort((a, b) => a.name.localeCompare(b.name));

    // Real-time translation. The default (fast) response only merges cached
    // translations; the client follows up with ?translate=1, which does the
    // batched LLM call and returns the upgraded list. That keeps first paint
    // fast while translations arrive a moment later. On failure the
    // pattern-based Korean (or English) baked into `description` stays.
    const wantsTranslation = new URL(request.url).searchParams.get("translate") === "1";
    const cacheFresh = Date.now() - translationCacheAt.value < TRANSLATION_CACHE_TTL_MS;
    if (wantsTranslation && !cacheFresh) {
      const toTranslate = [...new Set(models.map((m) => m.descriptionEn).filter((d): d is string => !!d))];
      const translated = await translateToKorean(
        toTranslate,
        models.map((m) => ({ id: m.id, traits: m.traits })),
      );
      let any = false;
      toTranslate.forEach((en, i) => {
        const ko = translated[i];
        if (ko) {
          translationCache.set(en, ko);
          any = true;
        }
      });
      if (any) translationCacheAt.value = Date.now();
    }
    for (const m of models) {
      if (m.descriptionEn && translationCache.has(m.descriptionEn)) {
        m.description = translationCache.get(m.descriptionEn) as string;
      }
    }

    return NextResponse.json({ source: "live", models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ source: "error", models: [], error: message }, { status: 502 });
  }
}
