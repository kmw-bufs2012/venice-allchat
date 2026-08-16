import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "APP_PASSWORD가 서버에 설정되어 있지 않습니다 — .env.local에 비밀번호를 넣고 다시 시작하세요." },
      { status: 500 },
    );
  }

  let username = "";
  let password = "";
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username === "string") username = body.username;
    if (typeof body.password === "string") password = body.password;
  } catch {
    // Malformed body falls through to the 401 below.
  }

  const passwordMatches =
    Buffer.from(password, "utf8").length === Buffer.from(expected, "utf8").length &&
    timingSafeEqual(Buffer.from(password, "utf8"), Buffer.from(expected, "utf8"));

  const expectedUsername = process.env.APP_USERNAME;
  let usernameMatches = true;
  if (expectedUsername) {
    usernameMatches =
      Buffer.from(username, "utf8").length === Buffer.from(expectedUsername, "utf8").length &&
      timingSafeEqual(Buffer.from(username, "utf8"), Buffer.from(expectedUsername, "utf8"));
  }

  if (!passwordMatches || !usernameMatches) {
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}