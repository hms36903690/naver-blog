import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { ACTIVE_STATUSES, getDb, transaction, type JobStatus } from "@/lib/db";
import { paths } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
  if (!job) return NextResponse.json({ error: "없는 작업입니다" }, { status: 404 });
  const draft = db.prepare("SELECT * FROM drafts WHERE job_id=? ORDER BY id DESC LIMIT 1").get(id) as
    | { id: number; title: string; body_json: string; category: string | null; tags: string | null }
    | undefined;
  return NextResponse.json({
    job,
    sources: db.prepare("SELECT id, type, title, url FROM sources WHERE job_id=? ORDER BY id").all(id),
    ideas: db.prepare("SELECT * FROM ideas WHERE job_id=? ORDER BY id").all(id),
    draft: draft ? { id: draft.id, title: draft.title, sections: JSON.parse(draft.body_json), category: draft.category, tags: draft.tags ? JSON.parse(draft.tags) : [] } : null,
    images: db.prepare("SELECT * FROM images WHERE job_id=? ORDER BY id").all(id),
    post: db.prepare("SELECT * FROM posts WHERE job_id=? ORDER BY id DESC LIMIT 1").get(id) ?? null,
    logs: db.prepare("SELECT id, level, message, created_at FROM job_logs WHERE job_id=? ORDER BY id").all(id),
  });
}

/**
 * [삭제] — 앱의 기록만 지운다(블로그에 올라간 글은 그대로). 사진 폴더도 지운다.
 * ⚠️ 하루 발행 수·이번 주 티스토리 수는 posts 기록으로 세므로, 발행·임시저장된 posts 행은 남겨 둔다
 *   (지우면 브레이크가 조용히 풀린다 — 7-22 와 같은 계열).
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const db = getDb();
  const job = db.prepare("SELECT status FROM jobs WHERE id=?").get(id) as { status: JobStatus } | undefined;
  if (!job) return NextResponse.json({ error: "없는 작업입니다" }, { status: 404 });
  if (ACTIVE_STATUSES.includes(job.status)) return NextResponse.json({ error: "진행 중인 작업은 끝난 뒤에 지울 수 있습니다" }, { status: 409 });
  transaction(() => {
    for (const t of ["job_logs", "sources", "ideas", "drafts", "images"]) db.prepare(`DELETE FROM ${t} WHERE job_id=?`).run(id);
    db.prepare("DELETE FROM posts WHERE job_id=? AND status NOT IN ('published','draft_saved','draft_unverified')").run(id);
    db.prepare("DELETE FROM jobs WHERE id=?").run(id);
  });
  try {
    fs.rmSync(path.join(paths.images, `job${id}`), { recursive: true, force: true });
  } catch {
    /* 사진 폴더가 열려 있으면 못 지울 수 있다 — 기록은 이미 지웠다 */
  }
  return NextResponse.json({ ok: true });
}
