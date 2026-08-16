"use client";

import { useEffect, useRef, useState } from "react";
import { traitLabel } from "@/lib/model-descriptions";

interface TextModelInfo {
  id: string;
  name: string;
  description: string;
  descriptionEn?: string;
  traits: string[];
  contextWindow: number | null;
  uncensored: boolean;
  supportsVision?: boolean;
  supportsMultipleImages?: boolean;
  supportsVideoInput?: boolean;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ImageAttachment {
  id: string;
  name: string;
  dataUrl: string;
}

interface VideoAttachment {
  name: string;
  frames: string[];
}

interface DocAttachment {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
  bytes: number;
}

type OutgoingPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { file_data: string; filename: string } };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("read failed")));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** Downscale to ≤1024px JPEG so 9 images fit inside the ~4.5MB proxy limit. */
async function fileToDownscaledDataUrl(file: File, maxDim = 1024, quality = 0.8): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close();
  }
}

/**
 * Samples evenly-spaced frames from a video as JPEG data URLs. 50MB videos
 * can't ride the ~4.5MB serverless proxy as raw base64, so vision models get
 * the video the same way they consume it: as key frames.
 */
async function extractVideoFrames(file: File, count = 6): Promise<string[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.src = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("video load failed"));
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const scale = Math.min(1, 1024 / Math.max(video.videoWidth || 1, video.videoHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((video.videoWidth || 1024) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 1024) * scale));
    const ctx = canvas.getContext("2d")!;
    const frames: string[] = [];
    for (let i = 0; i < count && duration > 0; i++) {
      const t = Math.min((duration * (i + 0.5)) / count, duration - 0.05);
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("seek failed"));
        video.currentTime = t;
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.8));
    }
    return frames;
  } finally {
    URL.revokeObjectURL(video.src);
  }
}

function modelLabel(m: TextModelInfo): string {
  const tag = m.uncensored ? " (무검열)" : "";
  const ctx = m.contextWindow ? ` · ${(m.contextWindow / 1000).toFixed(0)}k` : "";
  return `${m.name}${tag}${ctx}`;
}

/**
 * Approximate token count. Venice exposes no tokenization endpoint, so we
 * estimate: CJK characters (Korean/Chinese/Japanese) run ~1.1 tokens each in
 * modern tokenizers, other text ~4 characters per token.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk * 1.1 + rest / 4);
}

export default function ChatPage() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [models, setModels] = useState<TextModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelId, setModelId] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("당신은 도움이 되는 한국어 어시스턴트입니다. 모든 답변은 한국어로만 답변하십시오.");
  const [temperature, setTemperature] = useState(0.9);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [video, setVideo] = useState<VideoAttachment | null>(null);
  const [docs, setDocs] = useState<DocAttachment[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") setTheme(stored);

    // Fast first paint with the model list (static Korean descriptions),
    // then a background pass that upgrades descriptions with live LLM
    // translation — the user can already pick a model meanwhile.
    fetch("/api/models")
      .then((r) => r.json())
      .then((d: { models?: TextModelInfo[]; error?: string }) => {
        if (d.error) setModelsError(d.error);
        const list = d.models ?? [];
        setModels(list);
        // Default pick: the user's last choice, then Qwen 3.6 Plus Uncensored
        // (final pick: official uncensored tuning, 1M context, best long-form
        // quality), then GLM 4.7 Flash Heretic as the budget fallback.
        let saved: string | null = null;
        try {
          saved = localStorage.getItem("preferredModel");
        } catch {
          // private mode etc. — fall through to the default chain
        }
        const preferred =
          list.find((m) => m.id === saved) ??
          list.find((m) => /qwen-3-6-plus/i.test(m.id) && m.uncensored) ??
          list.find((m) => /glm-4-7.*heretic|heretic.*glm-4-7/i.test(m.id)) ??
          list.find((m) => m.uncensored) ??
          list[0];
        if (preferred) setModelId(preferred.id);
        return fetch("/api/models?translate=1");
      })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { models?: TextModelInfo[] } | null) => {
        if (d?.models?.length) setModels(d.models);
      })
      .catch(() => setModelsError("모델 목록을 불러올 수 없습니다."));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  function cycleTheme() {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
    if (next === "system") {
      localStorage.removeItem("theme");
      document.documentElement.removeAttribute("data-theme");
      document.documentElement.style.colorScheme = "";
    } else {
      localStorage.setItem("theme", next);
      document.documentElement.setAttribute("data-theme", next);
      document.documentElement.style.colorScheme = next;
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    window.location.replace("/login");
  }

  async function handleImages(files: FileList | null) {
    if (!files) return;
    setAttachBusy(true);
    try {
      const room = 9 - images.length;
      const next: ImageAttachment[] = [];
      for (const f of Array.from(files).slice(0, room)) {
        if (!f.type.startsWith("image/")) continue;
        try {
          next.push({ id: crypto.randomUUID(), name: f.name, dataUrl: await fileToDownscaledDataUrl(f) });
        } catch {
          setChatError(`이미지 처리 실패: ${f.name}`);
        }
      }
      if (next.length) setImages((prev) => [...prev, ...next].slice(0, 9));
    } finally {
      setAttachBusy(false);
    }
  }

  async function handleVideo(file: File | undefined) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setChatError("동영상은 50MB 이하만 첨부할 수 있습니다.");
      return;
    }
    setAttachBusy(true);
    try {
      const frames = await extractVideoFrames(file, 6);
      setVideo({ name: file.name, frames });
    } catch {
      setChatError("동영상 프레임 추출에 실패했습니다.");
    } finally {
      setAttachBusy(false);
    }
  }

  async function handleDocs(files: FileList | null) {
    if (!files) return;
    const next: DocAttachment[] = [];
    for (const f of Array.from(files).slice(0, 5 - docs.length)) {
      if (!/\.(txt|md|pdf)$/i.test(f.name)) continue;
      if (f.size > 3 * 1024 * 1024) {
        setChatError(`문서는 3MB 이하만 첨부할 수 있습니다: ${f.name}`);
        continue;
      }
      try {
        const dataUrl = await readAsDataUrl(f);
        const mime = f.type || (f.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/plain");
        next.push({ id: crypto.randomUUID(), name: f.name, mime, dataUrl, bytes: f.size });
      } catch {
        setChatError(`문서 읽기 실패: ${f.name}`);
      }
    }
    if (next.length) setDocs((prev) => [...prev, ...next].slice(0, 5));
  }

  async function send() {
    const text = input.trim();
    const hasAttachments = images.length > 0 || video !== null || docs.length > 0;
    if ((!text && !hasAttachments) || !modelId || streaming) return;
    setInput("");
    setChatError(null);

    // Attachments ride only the outgoing message as content parts; history
    // keeps plain text so old images/docs aren't re-uploaded every turn.
    const parts: OutgoingPart[] = [];
    const finalText = text || "(첨부 파일을 참고해 답변하세요)";
    parts.push({ type: "text", text: finalText });
    for (const img of images) parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
    if (video) {
      for (const frame of video.frames) parts.push({ type: "image_url", image_url: { url: frame } });
    }
    for (const d of docs) parts.push({ type: "file", file: { file_data: d.dataUrl, filename: d.name } });

    const history = [...messages, { role: "user" as const, content: finalText }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    const priorTurns = history.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    const payloadMessages: Array<{ role: string; content: string | OutgoingPart[] }> = [
      ...(systemPrompt.trim() ? [{ role: "system", content: systemPrompt.trim() }] : []),
      ...priorTurns,
      { role: "user", content: parts },
    ];

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, messages: payloadMessages, temperature }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `요청 실패 (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              acc += delta;
              setMessages([...history, { role: "assistant", content: acc }]);
            }
          } catch {
            // partial JSON — wait for more chunks
          }
        }
      }
      if (!acc) {
        setMessages([...history, { role: "assistant", content: "(응답 없음)" }]);
      }
      // Attachments are consumed by the completed request — clear for the next one.
      setImages([]);
      setVideo(null);
      setDocs([]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
      setMessages(history);
    } finally {
      setStreaming(false);
    }
  }

  const selected = models.find((m) => m.id === modelId);

  const visionCount = images.length + (video?.frames.length ?? 0);
  // Images/video frames only make sense on models that can see.
  const needsVision = visionCount > 0 && selected?.supportsVision !== true;
  const multiImageNote = visionCount > 1 && selected?.supportsMultipleImages === false;

  const conversationTokens =
    estimateTokens(systemPrompt) + messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const inputTokens = estimateTokens(input);
  const attachmentTokens =
    visionCount * 800 + docs.reduce((sum, d) => sum + Math.ceil(d.bytes * (d.mime.includes("pdf") ? 0.05 : 0.25)), 0);
  const totalTokens = conversationTokens + inputTokens + attachmentTokens;
  const ctxLimit = selected?.contextWindow ?? null;
  const nearLimit = ctxLimit !== null && totalTokens > ctxLimit * 0.9;
  const hasAttachments = images.length > 0 || video !== null || docs.length > 0;
  const canSend =
    !!modelId && !streaming && !attachBusy && !needsVision && (input.trim().length > 0 || hasAttachments);

  return (
    <main style={{ maxWidth: 880 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ marginBottom: 0 }}>Venice AllChat</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={cycleTheme} style={{ marginTop: 0, padding: "6px 14px" }}>
            {theme === "light" ? "☀️ 라이트" : theme === "dark" ? "🌙 다크" : "💻 시스템"}
          </button>
          <button onClick={logout} style={{ marginTop: 0, padding: "6px 14px" }}>
            로그아웃
          </button>
        </div>
      </div>
      <p className="subtitle">올인원 멀티 모델 AI 챗봇 — Venice.ai 전체 LLM (무검열 포함)</p>

      <div className="panel" style={{ paddingBottom: 14 }}>
        <label htmlFor="model">모델 ({models.length}개)</label>
        <select
          id="model"
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value);
            try {
              localStorage.setItem("preferredModel", e.target.value);
            } catch {
              // storage unavailable — selection just won't persist
            }
          }}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {modelLabel(m)}
            </option>
          ))}
        </select>
        {modelsError && <p className="error">{modelsError}</p>}
        {selected?.description && (
          <p className="note" title={selected.descriptionEn || undefined}>
            {selected.description}
          </p>
        )}
        {selected?.traits && selected.traits.length > 0 && (
          <p className="note">{selected.traits.map(traitLabel).join(" · ")}</p>
        )}

        <label htmlFor="system">시스템 프롬프트 (선택)</label>
        <textarea
          id="system"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="입력하지 않으면 시스템 프롬프트 없이 진행됩니다."
          style={{ minHeight: 60 }}
        />

        <label htmlFor="temp">온도: {temperature.toFixed(2)}</label>
        <input
          id="temp"
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
          style={{ width: "100%", padding: 0, border: "none", background: "transparent" }}
        />
      </div>

      <div className="panel chat-panel">
        {messages.length === 0 && (
          <p className="note" style={{ textAlign: "center", marginTop: 32 }}>
            모델을 고르고 메시지를 보내면 대화가 시작됩니다.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
        {chatError && <p className="error">{chatError}</p>}
        <div ref={bottomRef} />
      </div>

      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => imgInputRef.current?.click()}
            disabled={streaming || attachBusy || images.length >= 9}
            style={{ marginTop: 0, padding: "6px 12px", fontSize: 12 }}
          >
            🖼 이미지 ({images.length}/9)
          </button>
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            disabled={streaming || attachBusy || video !== null}
            style={{ marginTop: 0, padding: "6px 12px", fontSize: 12 }}
          >
            🎬 동영상 {video ? "1/1" : "(≤50MB)"}
          </button>
          <button
            type="button"
            onClick={() => docInputRef.current?.click()}
            disabled={streaming || attachBusy || docs.length >= 5}
            style={{ marginTop: 0, padding: "6px 12px", fontSize: 12 }}
          >
            📄 문서 ({docs.length}/5)
          </button>
          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void handleImages(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              void handleVideo(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={docInputRef}
            type="file"
            accept=".txt,.md,.pdf"
            multiple
            hidden
            onChange={(e) => {
              void handleDocs(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {(images.length > 0 || video || docs.length > 0) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {images.map((img) => (
              <span key={img.id} className="attach-chip" title={img.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.dataUrl} alt={img.name} />
                <button type="button" className="chip-remove" onClick={() => setImages((p) => p.filter((x) => x.id !== img.id))}>
                  ✕
                </button>
              </span>
            ))}
            {video && (
              <span className="attach-chip wide" title={`${video.name} — 프레임 ${video.frames.length}장 추출`}>
                🎬 {video.name} ({video.frames.length}프레임)
                <button type="button" className="chip-remove" onClick={() => setVideo(null)}>
                  ✕
                </button>
              </span>
            )}
            {docs.map((d) => (
              <span key={d.id} className="attach-chip wide" title={d.name}>
                📄 {d.name}
                <button type="button" className="chip-remove" onClick={() => setDocs((p) => p.filter((x) => x.id !== d.id))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {attachBusy && <p className="note" style={{ margin: 0 }}>첨부 처리 중…</p>}
        {needsVision && (
          <p className="error" style={{ margin: 0 }}>
            선택한 모델은 이미지를 이해할 수 없습니다 — 비전 지원 모델(예: Qwen 3.6 Plus)을 선택하세요.
          </p>
        )}
        {multiImageNote && (
          <p className="note" style={{ margin: 0 }}>
            이 모델은 여러 이미지 동시 처리가 제한적일 수 있습니다 — Qwen 3.6 Plus를 권장합니다.
          </p>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="메시지를 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
            style={{ minHeight: 56, flex: 1, marginTop: 0 }}
            disabled={streaming}
          />
          <button onClick={send} disabled={!canSend} style={{ marginTop: 0 }}>
            {streaming ? "응답 중…" : "전송"}
          </button>
          <button
            onClick={() => {
              setMessages([]);
              setChatError(null);
            }}
            disabled={streaming || messages.length === 0}
            style={{ marginTop: 0 }}
          >
            새 대화
          </button>
        </div>
      </div>
      <p className={`charcount${nearLimit ? " over" : ""}`} style={{ margin: "-14px 4px 0" }}>
        예상 토큰 — 입력: 약 {inputTokens.toLocaleString()}
        {attachmentTokens > 0 && ` · 첨부: 약 ${attachmentTokens.toLocaleString()}`} · 대화 전체: 약 {totalTokens.toLocaleString()}
        {ctxLimit !== null && ` / ${(ctxLimit / 1000).toFixed(0)}k`}
        {nearLimit && " ⚠ 컨텍스트 거의 찼음 — 새 대화를 시작하세요"}
      </p>
    </main>
  );
}
