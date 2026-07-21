import { getRuntimeEnv } from "./runtime-env.ts";
import { isIP } from "node:net";

const SESSION_COOKIE = "wm_session";
const SESSION_DAYS = 14;
const INVALID_PASSWORD_HASH = "0".repeat(64);
const INVALID_PASSWORD_SALT = "worldmodel-invalid-account";

type AuthRateLimitAction = "login" | "register";
type AuthRateLimitScope = "ip" | "email" | "pair";
type AuthRateLimitPolicy = { scope: AuthRateLimitScope; limit: number; windowSeconds: number };

const AUTH_RATE_LIMIT_POLICIES: Record<AuthRateLimitAction, AuthRateLimitPolicy[]> = {
  login: [
    { scope: "ip", limit: 50, windowSeconds: 15 * 60 },
    { scope: "email", limit: 15, windowSeconds: 15 * 60 },
    { scope: "pair", limit: 5, windowSeconds: 15 * 60 },
  ],
  register: [
    { scope: "ip", limit: 12, windowSeconds: 60 * 60 },
    { scope: "email", limit: 4, windowSeconds: 60 * 60 },
    { scope: "pair", limit: 3, windowSeconds: 60 * 60 },
  ],
};

export class InvalidCredentialsError extends Error {
  constructor() { super("Email or password is incorrect"); }
}

export class AuthInputError extends Error {}

export class AccountUnavailableError extends Error {
  constructor() { super("Unable to create account with those details"); }
}

async function database() {
  const db = (await getRuntimeEnv()).DB;
  if (!db) throw new Error("Authentication storage is unavailable");
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, organization_name TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_login_at TEXT)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_idx ON auth_users(lower(email))"),
    db.prepare("CREATE TABLE IF NOT EXISTS auth_sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS auth_rate_limits (bucket_hash TEXT PRIMARY KEY, action TEXT NOT NULL, scope TEXT NOT NULL, window_started_at INTEGER NOT NULL, window_expires_at INTEGER NOT NULL, attempt_count INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_rate_limits_expiry_idx ON auth_rate_limits(window_expires_at)"),
  ]);
  return db;
}

function bytes(length: number) {
  const value = new Uint8Array(length);
  crypto.getRandomValues(value);
  return value;
}

function hex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function passwordDigest(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 210_000 }, key, 256);
  return hex(new Uint8Array(derived));
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function sameDigest(left: string, right: string) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

export function trustedRequestIp(request: Request) {
  if (process.env.VERCEL !== "1") return null;
  const value = request.headers.get("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim() || "";
  return isIP(value) ? value : null;
}

function rateLimitValue(scope: AuthRateLimitScope, email: string, ip: string | null) {
  if (scope === "email") return email || null;
  if (scope === "ip") return ip;
  return email && ip ? `${email}\u0000${ip}` : null;
}

async function rateLimitBucketHash(action: AuthRateLimitAction, scope: AuthRateLimitScope, value: string) {
  return sha256(`auth-rate-limit\u0000${action}\u0000${scope}\u0000${value}`);
}

export type AuthRateLimitResult = { allowed: true } | { allowed: false; retryAfter: number };

export async function consumeAuthRateLimit(action: AuthRateLimitAction, emailInput: string, request: Request, nowSeconds = Math.floor(Date.now() / 1000)): Promise<AuthRateLimitResult> {
  const db = await database();
  const email = normalizedEmail(emailInput);
  const ip = trustedRequestIp(request);
  let retryAfter = 0;

  for (const policy of AUTH_RATE_LIMIT_POLICIES[action]) {
    const value = rateLimitValue(policy.scope, email, ip);
    if (!value) continue;
    const bucketHash = await rateLimitBucketHash(action, policy.scope, value);
    const expiresAt = nowSeconds + policy.windowSeconds;
    const row = await db.prepare(`
      INSERT INTO auth_rate_limits (bucket_hash, action, scope, window_started_at, window_expires_at, attempt_count)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(bucket_hash) DO UPDATE SET
        action = excluded.action,
        scope = excluded.scope,
        window_started_at = CASE WHEN auth_rate_limits.window_expires_at <= excluded.window_started_at THEN excluded.window_started_at ELSE auth_rate_limits.window_started_at END,
        window_expires_at = CASE WHEN auth_rate_limits.window_expires_at <= excluded.window_started_at THEN excluded.window_expires_at ELSE auth_rate_limits.window_expires_at END,
        attempt_count = CASE WHEN auth_rate_limits.window_expires_at <= excluded.window_started_at THEN 1 ELSE MIN(auth_rate_limits.attempt_count + 1, ?) END
      RETURNING attempt_count, window_expires_at
    `).bind(bucketHash, action, policy.scope, nowSeconds, expiresAt, policy.limit + 1).first<{ attempt_count: number; window_expires_at: number }>();
    if (!row) throw new Error("AUTH_RATE_LIMIT_WRITE_FAILED");
    if (Number(row.attempt_count) > policy.limit) {
      retryAfter = Math.max(retryAfter, Math.max(1, Number(row.window_expires_at) - nowSeconds));
      break;
    }
    if (bucketHash.startsWith("00")) {
      await db.prepare("DELETE FROM auth_rate_limits WHERE window_expires_at < ?").bind(nowSeconds - 86_400).run();
    }
  }

  return retryAfter > 0 ? { allowed: false, retryAfter } : { allowed: true };
}

export async function relaxSuccessfulLoginRateLimit(emailInput: string, request: Request) {
  const db = await database();
  const email = normalizedEmail(emailInput);
  const ip = trustedRequestIp(request);
  const hashes = await Promise.all((["email", "pair"] as const).flatMap((scope) => {
    const value = rateLimitValue(scope, email, ip);
    return value ? [rateLimitBucketHash("login", scope, value)] : [];
  }));
  for (const bucketHash of hashes) await db.prepare("DELETE FROM auth_rate_limits WHERE bucket_hash = ?").bind(bucketHash).run();
}

export async function registerAccount(input: { email: string; password: string; displayName: string; organizationName: string }) {
  const email = normalizedEmail(input.email);
  const displayName = input.displayName.trim();
  const organizationName = input.organizationName.trim();
  if (!validEmail(email)) throw new AuthInputError("Enter a valid business email address");
  if (displayName.length < 2 || displayName.length > 80) throw new AuthInputError("Your name must be between 2 and 80 characters");
  if (organizationName.length < 2 || organizationName.length > 100) throw new AuthInputError("Organization name must be between 2 and 100 characters");
  if (input.password.length < 10 || input.password.length > 128) throw new AuthInputError("Password must be between 10 and 128 characters");
  const db = await database();
  const salt = hex(bytes(24));
  const digest = await passwordDigest(input.password, salt);
  const existing = await db.prepare("SELECT id FROM auth_users WHERE lower(email) = lower(?)").bind(email).first();
  if (existing) throw new AccountUnavailableError();
  const id = `usr_${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    await db.prepare("INSERT INTO auth_users (id, email, display_name, organization_name, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?)").bind(id, email, displayName, organizationName, digest, salt).run();
  } catch (error) {
    if (/unique|constraint/i.test(error instanceof Error ? error.message : String(error))) throw new AccountUnavailableError();
    throw error;
  }
  return { id, email, displayName, organizationName };
}

export async function authenticateAccount(emailInput: string, password: string) {
  const email = normalizedEmail(emailInput);
  const db = await database();
  const user = await db.prepare("SELECT id, email, display_name, organization_name, password_hash, password_salt, status FROM auth_users WHERE lower(email) = lower(?)").bind(email).first<Record<string, unknown>>();
  const digest = await passwordDigest(password, user ? String(user.password_salt) : INVALID_PASSWORD_SALT);
  const passwordMatches = sameDigest(digest, user ? String(user.password_hash) : INVALID_PASSWORD_HASH);
  if (!user || user.status !== "active" || !passwordMatches) throw new InvalidCredentialsError();
  await db.prepare("UPDATE auth_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id).run();
  return { id: String(user.id), email: String(user.email), displayName: String(user.display_name), organizationName: String(user.organization_name) };
}

export async function createSession(userId: string) {
  const token = hex(bytes(32));
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  const db = await database();
  await db.prepare("INSERT INTO auth_sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), userId, expiresAt).run();
  return { token, expiresAt };
}

export async function destroySession(token: string | null) {
  if (!token) return;
  const db = await database();
  await db.prepare("DELETE FROM auth_sessions WHERE id_hash = ?").bind(await sha256(token)).run();
}

function cookieValue(header: string | null, name: string) {
  if (!header) return null;
  for (const rawPart of header.split(";")) {
    const part = rawPart.trim();
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionToken(request: Request) {
  return cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
}

export async function sessionUser(cookieHeader: string | null) {
  const token = cookieValue(cookieHeader, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const db = await database();
  const tokenHash = await sha256(token);
  const row = await db.prepare("SELECT u.id, u.email, u.display_name, u.organization_name FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.id_hash = ? AND u.status = 'active' AND datetime(s.expires_at) > CURRENT_TIMESTAMP").bind(tokenHash).first<Record<string, unknown>>();
  if (!row) return null;
  return { id: String(row.id), email: String(row.email), displayName: String(row.display_name), organizationName: String(row.organization_name) };
}

export function sessionCookie(token: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
