import { NextResponse } from "next/server";
import { requireVeniceKey } from "@/lib/venice";

export const runtime = "nodejs";

const BASE_URL = "https://api.venice.ai/api/v1";

// ~4MB guard: Vercel caps request bodies at ~4.5MB, so stay under it with headroom.
const MAX_BODY_BYTES = 4_000_000;

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { file_data: string; filename: string } };

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/**
 * Streaming proxy to Venice's OpenAI-compatible /chat/completions.
 * User messages may carry image and document attachments as content parts
 * (data URLs only — relaying arbitrary URLs would make us an SSRF vector).
 * Streams SSE deltas straight through to the client.
 */
export async function POST(request: Request) {
  let model = "";
  let messages: ChatMessage[] = [];
  let temperature = 0.9;
  try {
    const body = (await request.json()) as {
      model?: unknown;
      messages?: unknown;
      temperature?: unknown;
    };
    if (typeof body.model === "string") model = body.model;
    if (Array.isArray(body.messages)) {
      messages = (body.messages as unknown[]).filter(
        (m): m is ChatMessage =>
          !!m &&
          typeof m === "object" &&
          typeof (m as ChatMessage).role === "string" &&
          (typeof (m as ChatMessage).content === "string" || Array.isArray((m as ChatMessage).content)),
      );
    }
    if (typeof body.temperature === "number") temperature = body.temperature;
  } catch {
    // falls through to validation below
  }

  if (!model || messages.length === 0) {
    return NextResponse.json({ error: "model과 messages가 필요합니다." }, { status: 400 });
  }

  const sanitized = messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    const parts: ContentPart[] = [];
    for (const raw of m.content) {
      const part = raw as Partial<ContentPart>;
      if (part?.type === "text" && typeof part.text === "string" && part.text) {
        parts.push({ type: "text", text: part.text });
      } else if (
        part?.type === "image_url" &&
        typeof part.image_url?.url === "string" &&
        part.image_url.url.startsWith("data:image/")
      ) {
        parts.push({ type: "image_url", image_url: { url: part.image_url.url } });
      } else if (
        part?.type === "file" &&
        typeof part.file?.file_data === "string" &&
        part.file.file_data.startsWith("data:") &&
        typeof part.file.filename === "string" &&
        part.file.filename.length <= 200
      ) {
        parts.push({ type: "file", file: { file_data: part.file.file_data, filename: part.file.filename } });
      }
    }
    // Non-user roles must be plain text (Venice rejects parts elsewhere).
    if (m.role !== "user") {
      const text = parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .filter(Boolean)
        .join("\n");
      return { role: m.role, content: text };
    }
    return { role: m.role, content: parts };
  });

  const payload = JSON.stringify({ model, messages: sanitized, temperature, stream: true, venice_parameters: { include_venice_system_prompt: false } });
  if (payload.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "첨부 용량이 너무 큽니다 — 이미지 수를 줄이거나 문서 크기를 줄여주세요." },
      { status: 413 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireVeniceKey()}`,
        "Content-Type": "application/json",
      },
      body: payload,
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
