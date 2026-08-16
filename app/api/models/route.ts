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
      const traits = m.model_spec?.traits ?? [];
      return {
        id: m.id,
        name: m.name ?? m.id,
        description: m.description ?? "",
        traits,
        contextWindow: m.availableContextWindow ?? null,
        uncensored: !traits.includes("system-safety-message"),
      };
    });
    models.sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ source: "live", models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ source: "error", models: [], error: message }, { status: 502 });
  }
}
