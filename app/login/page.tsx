"use client";

import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.replace("/");
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "로그인에 실패했습니다.");
      setBusy(false);
    } catch {
      setError("서버에 연결할 수 없습니다.");
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "100vh" }}>
      <div className="panel">
        <h1 style={{ fontSize: 26 }}>Venice AllChat</h1>
        <p className="subtitle">아이디와 비밀번호를 입력해 접속하세요</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="username">아이디</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            style={{ width: "100%" }}
          />
          <label htmlFor="password">비밀번호</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            style={{ width: "100%" }}
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || password.length === 0} style={{ marginTop: 16, width: "100%" }}>
            {busy ? "확인 중…" : "접속"}
          </button>
        </form>
      </div>
    </main>
  );
}
