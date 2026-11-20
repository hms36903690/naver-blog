import { NextResponse } from "next/server";
import { z } from "zod";
import { generateIdeas } from "@/lib/ai/content";
import { scrapeTrends } from "@/lib/scrape/trends";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  keyword: z.string().trim().min(1).max(100),
  target: z.enum(["naver", "tistory"]).default("naver"),
  category: z.enum(["life", "money", "health", "tax", "fund", "wage", "rent", "inherit", "finance"]).optional(),
});

/** [제목 추천] — 요즘 뉴스·블로그를 모아 제목 후보 8개를 돌려준다. 아무것도 저장·발행하지 않는다. */
export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return NextResponse.json({ error: "키워드를 입력하세요" }, { status: 400 });
  const s = getSettings();
  const notes: string[] = [];
  const sources = await scrapeTrends(p.data.keyword, s.scrapeTopN, { headless: !s.showBrowser, log: (m) => notes.push(m) }).catch(() => []);
  const r = await generateIdeas(p.data.keyword, sources, 8, undefined, p.data.target, p.data.target === "tistory" ? s.tistoryStyle : "", p.data.category);
  if (!r.ok) return NextResponse.json({ error: `제목 추천 실패: ${r.error.slice(0, 160)}` }, { status: 500 });
  return NextResponse.json({ ideas: r.data.slice(0, 8), sources, notes });
}
