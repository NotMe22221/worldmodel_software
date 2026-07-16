import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type RunResult = { success: boolean; meta: { changes: number; last_row_id: number | string } };

class LocalStatement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private readonly values: unknown[];
  constructor(database: DatabaseSync, sql: string, values: unknown[] = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values: unknown[]) { return new LocalStatement(this.database, this.sql, values); }
  private inputs() { return this.values as SQLInputValue[]; }
  first<T = Record<string, unknown>>() { return Promise.resolve((this.database.prepare(this.sql).get(...this.inputs()) as T | undefined) || null); }
  all<T = Record<string, unknown>>() { return Promise.resolve({ results: this.database.prepare(this.sql).all(...this.inputs()) as T[] }); }
  run(): Promise<RunResult> { const result = this.database.prepare(this.sql).run(...this.inputs()); return Promise.resolve({ success: true, meta: { changes: Number(result.changes), last_row_id: typeof result.lastInsertRowid === "bigint" ? result.lastInsertRowid.toString() : Number(result.lastInsertRowid) } }); }
}

class LocalD1 {
  private readonly database: DatabaseSync;
  constructor(filename: string) { this.database = new DatabaseSync(filename); this.database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"); }
  prepare(sql: string) { return new LocalStatement(this.database, sql); }
  async batch(statements: LocalStatement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.exec("COMMIT"); return results; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}

class LocalR2 {
  private readonly root: string;
  constructor(root: string) { this.root = root; }
  private location(key: string) { const safe = key.split("/").filter((part) => part && part !== "." && part !== ".."); return path.join(this.root, ...safe); }
  async put(key: string, value: string | ArrayBuffer) { const location = this.location(key); await mkdir(path.dirname(location), { recursive: true }); await writeFile(location, typeof value === "string" ? value : Buffer.from(value)); return { key }; }
  async get(key: string) { try { const content = await readFile(this.location(key)); return { text: async () => content.toString("utf8"), arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) }; } catch { return null; } }
}

type LocalGlobal = typeof globalThis & { __worldmodelLocalEnv?: Record<string, unknown> };

export async function localRuntimeEnv() {
  const global = globalThis as LocalGlobal;
  if (global.__worldmodelLocalEnv) return global.__worldmodelLocalEnv;
  // Keep SQLite WAL/SHM files outside the source tree. Turbopack watches the
  // project recursively on Windows and can otherwise panic on SQLite's locks.
  const state = process.env.WORLDMODEL_LOCAL_STATE_DIR || path.join(tmpdir(), "worldmodel-software-local");
  await mkdir(state, { recursive: true });
  global.__worldmodelLocalEnv = {
    ...process.env,
    DB: new LocalD1(path.join(state, "worldmodel.sqlite")),
    ARTIFACTS: new LocalR2(path.join(state, "artifacts")),
    LOCAL_DEVELOPMENT: "true",
  };
  return global.__worldmodelLocalEnv;
}
