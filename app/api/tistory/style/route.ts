import { NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { learnTistoryStyle } from "@/lib/tistory/style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 내 티스토리 최근 글(RSS)을 읽어 글투 안내를 만들고 설정에 저장한다. 로그인 불필요. */
export async function POST() {
  const blog = getSettings().tistoryBlog;
  if (!blog) return NextResponse.json({ error: "설정에서 티스토리 주소를 먼저 넣어주세요." }, { status: 400 });
  try {
    const r = await learnTistoryStyle(blog);
    return NextResponse.json({ ...r, settings: getSettings() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
