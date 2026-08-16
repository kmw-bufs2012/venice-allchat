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
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState(0.9);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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

  async function send() {
    const text = input.trim();
    if (!text || !modelId || streaming) return;
    setInput("");
    setChatError(null);
    const history = [...messages, { role: "user" as const, content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    const payloadMessages = systemPrompt.trim()
      ? [{ role: "system", content: systemPrompt.trim() }, ...history]
      : history;

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
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
      setMessages(history);
    } finally {
      setStreaming(false);
    }
  }

  const selected = models.find((m) => m.id === modelId);

  const conversationTokens =
    estimateTokens(systemPrompt) + messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const inputTokens = estimateTokens(input);
  const totalTokens = conversationTokens + inputTokens;
  const ctxLimit = selected?.contextWindow ?? null;
  const nearLimit = ctxLimit !== null && totalTokens > ctxLimit * 0.9;

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
          placeholder="예: 당신은 도움이 되는 한국어 어시스턴트입니다."
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

      <div className="panel" style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
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
        <button onClick={send} disabled={streaming || !input.trim() || !modelId} style={{ marginTop: 0 }}>
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
      <p className={`charcount${nearLimit ? " over" : ""}`} style={{ margin: "-14px 4px 0" }}>
        예상 토큰 — 입력: 약 {inputTokens.toLocaleString()} · 대화 전체: 약 {totalTokens.toLocaleString()}
        {ctxLimit !== null && ` / ${(ctxLimit / 1000).toFixed(0)}k`}
        {nearLimit && " ⚠ 컨텍스트 거의 찼음 — 새 대화를 시작하세요"}
      </p>
    </main>
  );
}
