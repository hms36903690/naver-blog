import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

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
