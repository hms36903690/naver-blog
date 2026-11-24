import { NextResponse } from "next/server";
import { diagnoseNaver } from "@/lib/naver/diagnose";
import { verifySession } from "@/lib/naver/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** [네이버 화면 점검] — 글쓰기 화면을 열어 재기만 한다(발행 안 함, 글자 입력 안 함). */
export async function POST() {
  const s = await verifySession(true);
  if (s.state !== "valid") return NextResponse.json({ error: `네이버 로그인이 필요합니다: ${s.message}` }, { status: 400 });
  try {
    return NextResponse.json(await diagnoseNaver({ blogId: s.blogId }));
  } catch (e) {
    return NextResponse.json({ error: `점검 실패: ${(e as Error).message.split("\n")[0].slice(0, 200)}` }, { status: 500 });
  }
}
