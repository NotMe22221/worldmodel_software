import { getRuntimeEnv } from "./runtime-env.ts";

const SESSION_COOKIE = "wm_session";
const SESSION_DAYS = 14;

async function database() {
  const db = (await getRuntimeEnv()).DB;
  if (!db) throw new Error("Authentication storage is unavailable");
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, organization_name TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_login_at TEXT)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_idx ON auth_users(lower(email))"),
    db.prepare("CREATE TABLE IF NOT EXISTS auth_sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at)"),
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

export async function registerAccount(input: { email: string; password: string; displayName: string; organizationName: string }) {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const organizationName = input.organizationName.trim();
  if (!validEmail(email)) throw new Error("Enter a valid business email address");
  if (displayName.length < 2 || displayName.length > 80) throw new Error("Your name must be between 2 and 80 characters");
  if (organizationName.length < 2 || organizationName.length > 100) throw new Error("Organization name must be between 2 and 100 characters");
  if (input.password.length < 10 || input.password.length > 128) throw new Error("Password must be between 10 and 128 characters");
  const db = await database();
  const existing = await db.prepare("SELECT id FROM auth_users WHERE lower(email) = lower(?)").bind(email).first();
  if (existing) throw new Error("An account already exists for this email");
  const salt = hex(bytes(24));
  const id = `usr_${crypto.randomUUID().replaceAll("-", "")}`;
  await db.prepare("INSERT INTO auth_users (id, email, display_name, organization_name, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?)").bind(id, email, displayName, organizationName, await passwordDigest(input.password, salt), salt).run();
  return { id, email, displayName, organizationName };
}

export async function authenticateAccount(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const db = await database();
  const user = await db.prepare("SELECT id, email, display_name, organization_name, password_hash, password_salt, status FROM auth_users WHERE lower(email) = lower(?)").bind(email).first<Record<string, unknown>>();
  if (!user || user.status !== "active" || await passwordDigest(password, String(user.password_salt)) !== user.password_hash) throw new Error("Email or password is incorrect");
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
  const part = (header || "").split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

export function sessionToken(request: Request) {
  return cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
}

export async function sessionUser(cookieHeader: string | null) {
  const token = cookieValue(cookieHeader, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const db = await database();
  const row = await db.prepare("SELECT u.id, u.email, u.display_name, u.organization_name FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id WHERE s.id_hash = ? AND u.status = 'active' AND datetime(s.expires_at) > CURRENT_TIMESTAMP").bind(await sha256(token)).first<Record<string, unknown>>();
  if (!row) return null;
  await db.prepare("UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id_hash = ?").bind(await sha256(token)).run();
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
