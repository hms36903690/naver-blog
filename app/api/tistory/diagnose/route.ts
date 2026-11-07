import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { diagnoseTistory } from "@/lib/tistory/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** 티스토리 글쓰기 화면을 열어 재기만 한다(입력·저장 없음). */
export async function POST() {
  const blog = getSettings().tistoryBlog;
  if (!blog) return NextResponse.json({ error: "설정에서 티스토리 주소를 먼저 넣어주세요." }, { status: 400 });
  try {
    return NextResponse.json(await diagnoseTistory(blog));
  } catch (e) {
    return NextResponse.json({ error: `점검 실패: ${(e as Error).message.split("\n")[0].slice(0, 200)}` }, { status: 500 });
  }
}
