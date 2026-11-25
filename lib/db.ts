/**
 * ⚠️ better-sqlite3 대신 Node 내장 node:sqlite 를 쓴다.
 *   실측: 윈도우(Node 24)에서 npm install 이 better-sqlite3 를 소스에서 빌드하려다
 *   "Could not find any Visual Studio installation" 으로 설치 전체가 실패했다.
 *   내장 모듈은 빌드할 것이 없어 이 문제가 원천적으로 없다(Node 22.13+).
 */
import { DatabaseSync } from "node:sqlite";
import { ensureDirs, paths } from "./paths";

type DB = DatabaseSync;

// ⚠️ 7-17: Next.js dev 의 HMR 은 모듈을 여러 번 평가한다. globalThis 에 캐싱하지 않으면 커넥션이 계속 쌓인다.
const g = globalThis as unknown as { __blogDb?: DB };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  stage TEXT,
  auto INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'auto',
  inputs TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL, type TEXT NOT NULL, title TEXT, summary TEXT, url TEXT, content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL, title TEXT, angle TEXT, rationale TEXT, chosen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL, idea_id INTEGER, title TEXT, body_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL, draft_id INTEGER, query TEXT, src_url TEXT, local_path TEXT,
  source_site TEXT, verdict_ok INTEGER, verdict_reason TEXT, section_index INTEGER, gen_prompt TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL, draft_id INTEGER, status TEXT NOT NULL DEFAULT 'pending',
  blog_url TEXT, screenshot TEXT, note TEXT, published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL, level TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cf_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER, steps INTEGER NOT NULL, neurons REAL NOT NULL, ok INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_job ON job_logs(job_id, id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at);
`;

/** 스키마 변경: 기존 DB 를 날리지 않고 없는 컬럼만 ALTER TABLE 로 추가한다. */
const MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  // 예) { table: "jobs", column: "mode", ddl: "ALTER TABLE jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'" },
  { table: "jobs", column: "mode", ddl: "ALTER TABLE jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'" },
  { table: "jobs", column: "inputs", ddl: "ALTER TABLE jobs ADD COLUMN inputs TEXT" },
  { table: "images", column: "gen_prompt", ddl: "ALTER TABLE images ADD COLUMN gen_prompt TEXT" },
  { table: "drafts", column: "category", ddl: "ALTER TABLE drafts ADD COLUMN category TEXT" },
  { table: "drafts", column: "tags", ddl: "ALTER TABLE drafts ADD COLUMN tags TEXT" },
  { table: "posts", column: "target", ddl: "ALTER TABLE posts ADD COLUMN target TEXT" },
];

function migrate(db: DB) {
  db.exec(SCHEMA);
  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === m.column)) db.exec(m.ddl);
  }
}

export function getDb(): DB {
  if (g.__blogDb) return g.__blogDb;
  ensureDirs();
  const db = new DatabaseSync(paths.db);
  // SSE 폴링(읽기)과 파이프라인(쓰기)이 동시에 일어난다.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  g.__blogDb = db;
  return db;
}

/** BEGIN…COMMIT 로 감싼다(예외면 ROLLBACK). */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export type JobStatus =
  | "pending" | "scraping" | "writing" | "imaging" | "publishing" | "done" | "failed" | "canceled";
export type PostStatus = "pending" | "publishing" | "published" | "dry_run" | "failed" | "blocked";

export const ACTIVE_STATUSES: JobStatus[] = ["pending", "scraping", "writing", "imaging", "publishing"];

export function setJobStage(jobId: number, status: JobStatus, stage?: string, error?: string) {
  getDb()
    .prepare("UPDATE jobs SET status=?, stage=?, error=COALESCE(?, error), updated_at=datetime('now') WHERE id=?")
    .run(status, stage ?? null, error ?? null, jobId);
}

/**
 * ⚠️ 7-22: datetime('now') 는 UTC. "오늘"은 로컬 날짜 개념이므로 양쪽 다 localtime 으로 바꿔 비교한다.
 * 한쪽만 바꾸면 한국시간 새벽 발행이 어제로 집계돼 하루 한도가 조용히 느슨해진다.
 */
export function countPublishedToday(): number {
  const r = getDb()
    .prepare(
      "SELECT COUNT(*) n FROM posts WHERE status='published' AND date(published_at,'localtime') = date('now','localtime')",
    )
    .get() as { n: number };
  return r.n;
}

/** 이번 주(월~일, 로컬 날짜) 티스토리에 임시저장한 글 수. ⚠️ 7-22: 양쪽 다 localtime. */
export function countTistoryDraftsThisWeek(): number {
  const r = getDb()
    .prepare(
      `SELECT COUNT(*) n FROM posts WHERE status IN ('draft_saved','draft_unverified')
       AND (target='tistory' OR target IS NULL)
       AND date(created_at,'localtime') >= date('now','localtime','weekday 0','-6 days')`,
    )
    .get() as { n: number };
  return r.n;
}

export function lastPublishedAt(): Date | null {
  const r = getDb()
    .prepare("SELECT published_at FROM posts WHERE status='published' AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1")
    .get() as { published_at: string } | undefined;
  return r ? new Date(r.published_at.replace(" ", "T") + "Z") : null;
}
