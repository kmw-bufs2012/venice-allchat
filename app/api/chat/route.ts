import { NextResponse } from "next/server";
import { requireVeniceKey } from "@/lib/venice";

export const runtime = "nodejs";

const BASE_URL = "https://api.venice.ai/api/v1";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Streaming proxy to Venice's OpenAI-compatible /chat/completions.
 * Streams SSE deltas straight through to the client so tokens render
 * as they arrive.
 */
export async function POST(request: Request) {
  let model = "";
  let messages: ChatMessage[] = [];
  let temperature = 0.75;
  try {
    const body = (await request.json()) as {
      model?: unknown;
      messages?: unknown;
      temperature?: unknown;
    };
    if (typeof body.model === "string") model = body.model;
    if (Array.isArray(body.messages)) {
      messages = body.messages.filter(
        (m): m is ChatMessage =>
          !!m &&
          typeof m === "object" &&
          typeof (m as ChatMessage).role === "string" &&
          typeof (m as ChatMessage).content === "string",
      );
    }
    if (typeof body.temperature === "number") temperature = body.temperature;
  } catch {
    // falls through to validation below
  }

  if (!model || messages.length === 0) {
    return NextResponse.json({ error: "model과 messages가 필요합니다." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireVeniceKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, temperature, stream: true, VeniceParameters: { include_venice_system_prompt: false } }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Venice API 요청 실패: ${message}` }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Venice API ${upstream.status}: ${text.slice(0, 500)}` },
      { status: upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
