import { NextResponse } from "next/server";
import { veniceFetch, type TextModelInfo, type VeniceTextModel } from "@/lib/venice";

export const runtime = "nodejs";

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
      return {
        id: m.id,
        name: spec?.name ?? m.name ?? m.id,
        description: spec?.description ?? m.description ?? "",
        traits: spec?.traits ?? [],
        contextWindow: spec?.availableContextTokens ?? m.availableContextWindow ?? m.context_length ?? null,
        // Venice exposes uncensored status as a dedicated boolean field
        // (checked at both levels for API-version tolerance) — it is NOT a trait.
        uncensored: spec?.uncensored === true || m.uncensored === true,
      };
    });
    models.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ source: "live", models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ source: "error", models: [], error: message }, { status: 502 });
  }
}
