/**
 * Single-user password auth for the studio.
 *
 * Sessions are stateless signed tokens: `expiresEpoch.base64url(handle).hmac`,
 * where the HMAC covers the expiry, the login handle (GitHub username when
 * signed in via GitHub, empty for password login) AND the configured
 * APP_PASSWORD — so rotating the password or the handle invalidates every
 * outstanding session. Everything here runs on Web Crypto only, so the Edge
 * middleware (session check) and Node route handlers (login/logout/GitHub
 * callback) can share this module without bundling node:crypto. Password
 * comparison lives in the login route, which is Node-only.
 */

export const SESSION_COOKIE = "studio_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || "";
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(message: string): Promise<string> {
  const key = await hmacKey(getSecret());
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(signature));
}

/** Creates a signed session token valid for SESSION_TTL_MS. `handle` is the GitHub username for GitHub logins. */
export async function createSessionToken(handle = ""): Promise<string> {
  const expires = Date.now() + SESSION_TTL_MS;
  const message = `${expires}:${handle}:${process.env.APP_PASSWORD ?? ""}`;
  const handleB64 = toBase64Url(new TextEncoder().encode(handle));
  return `${expires}.${handleB64}.${await sign(message)}`;
}

/** Returns true only for an unexpired token signed with the current secret+credentials. */
export async function verifySessionToken(token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresStr, handleB64, sig] = parts;
  if (expiresStr === undefined || handleB64 === undefined || sig === undefined) return false;
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  let handle: string;
  try {
    handle = new TextDecoder().decode(fromBase64Url(handleB64));
  } catch {
    return false;
  }
  const expected = await sign(`${expiresStr}:${handle}:${process.env.APP_PASSWORD ?? ""}`);
  const expectedBytes = fromBase64Url(expected);
  const givenBytes = fromBase64Url(sig);
  if (expectedBytes.length !== givenBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) diff |= expectedBytes[i]! ^ givenBytes[i]!;
  return diff === 0;
}

/**
 * OAuth CSRF state for the GitHub flow: `random.uuid` + HMAC over the
 * random part, so the callback can verify the state came from us without
 * storing anything server-side.
 */
export async function createOAuthState(): Promise<string> {
  const random = crypto.randomUUID();
  return `${random}.${await sign(`state:${random}`)}`;
}

/** Returns true only for a state produced by createOAuthState. */
export async function verifyOAuthState(state: string): Promise<boolean> {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return false;
  const random = state.slice(0, dot);
  const expectedBytes = fromBase64Url(await sign(`state:${random}`));
  const givenBytes = fromBase64Url(state.slice(dot + 1));
  if (expectedBytes.length !== givenBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) diff |= expectedBytes[i]! ^ givenBytes[i]!;
  return diff === 0;
}