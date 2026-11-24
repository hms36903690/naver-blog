import { NextResponse } from "next/server";
import { ACTIVE_STATUSES, getDb, setJobStage } from "@/lib/db";
import { retryPublish } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** [다시 시도] — 저장된 글·그림 그대로 발행 단계만 다시(글을 새로 쓰지 않음) */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const db = getDb();
  const active = db
    .prepare(`SELECT id FROM jobs WHERE status IN (${ACTIVE_STATUSES.map(() => "?").join(",")}) LIMIT 1`)
    .get(...ACTIVE_STATUSES) as { id: number } | undefined;
  if (active) return NextResponse.json({ error: "진행 중인 작업이 끝난 뒤 다시 시도해 주세요", activeJobId: active.id }, { status: 409 });
  const draft = db.prepare("SELECT id FROM drafts WHERE job_id=? LIMIT 1").get(id);
  if (!draft) return NextResponse.json({ error: "이 작업에는 다시 올릴 글이 없습니다. 처음부터 다시 만들어 주세요." }, { status: 400 });
  setJobStage(id, "publishing", "다시 시도 중");
  retryPublish(id).catch(console.error); // fire-and-forget — 진행은 SSE 로
  return NextResponse.json({ ok: true });
}
