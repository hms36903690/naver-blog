import { NextResponse } from "next/server";
import { ACTIVE_STATUSES, getDb, transaction } from "@/lib/db";
import { createJob, runJob } from "@/lib/pipeline";
import { JobInput } from "@/lib/types";
import { hasCloudflare } from "@/config";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = getDb()
    .prepare(
      `SELECT j.id, j.keyword, j.status, j.stage, j.mode, j.error, j.created_at, j.updated_at,
              (SELECT status FROM posts p WHERE p.job_id=j.id ORDER BY id DESC LIMIT 1) AS post_status
       FROM jobs j ORDER BY j.id DESC LIMIT 30`,
    )
    .all();
  return NextResponse.json({ jobs: rows });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 잘못됐습니다" }, { status: 400 });
  }
  const parsed = JobInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "입력 오류" }, { status: 400 });
  const input = parsed.data;
  if (input.mode === "auto" && input.photoSource === "local")
    return NextResponse.json({ error: "자동 발굴에는 '내 사진'을 쓸 수 없습니다" }, { status: 400 });
  if (input.photoSource === "local" && !input.photoFolder.trim())
    return NextResponse.json({ error: "사진 폴더를 골라주세요" }, { status: 400 });
  if (input.target === "tistory" && !getSettings().tistoryBlog)
    return NextResponse.json({ error: "설정에서 티스토리 주소를 먼저 넣어주세요" }, { status: 400 });
  if (input.photoSource === "ai" && !hasCloudflare())
    return NextResponse.json({ error: "AI 사진을 만들려면 Cloudflare 열쇠가 필요합니다" }, { status: 400 });

  // ⚠️ 7-16: 버튼 연타·SSE 재연결로 같은 잡이 두 번 생긴다 → 진행 중 잡이 있으면 409
  const db = getDb();
  const id = transaction(() => {
    const active = db
      .prepare(`SELECT id FROM jobs WHERE status IN (${ACTIVE_STATUSES.map(() => "?").join(",")}) LIMIT 1`)
      .get(...ACTIVE_STATUSES) as { id: number } | undefined;
    if (active) return -active.id;
    return createJob(input);
  });
  if (id < 0) return NextResponse.json({ error: "이미 진행 중인 작업이 있습니다", activeJobId: -id }, { status: 409 });

  // fire-and-forget — 진행 상황은 SSE 로
  runJob(id).catch(console.error);
  return NextResponse.json({ id });
}
