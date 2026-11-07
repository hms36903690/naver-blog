import type { Page } from "playwright";
import { newContext } from "../playwright";
import type { Source } from "../types";
import { NAVER } from "./selectors";

export type RawAnchor = { href: string; text: string; ctx: string };

/**
 * 셀렉터에 의존하지 않는다 — 네이버 검색 DOM 은 자주 바뀐다. 모든 a[href] 를 훑어 원시 목록만 뽑는다.
 * 필터링은 Node 쪽 filterAnchors() 에서(테스트 가능하도록 순수 함수로 분리).
 */
async function collectAnchors(page: Page): Promise<RawAnchor[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("a[href]")].map((a) => {
      const el = a as HTMLAnchorElement;
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      const box = el.closest("li, div");
      const ctx = (box ? (box as HTMLElement).innerText || box.textContent || "" : "").replace(/\s+/g, " ").trim();
      return { href: el.href, text, ctx: ctx.slice(0, 1200) };
    }),
  );
}

const NOISE = /광고|로그인|더보기|바로가기|언론사 선정|구독/;
// ⚠️ `/news/` 조건에 네이버 고객센터(help.naver.com/alias/news/news_21.naver)가 걸린다 —
//   "뉴스 기사와 댓글로 인한 문제 발생시 24시간 센터로…" 가 AI 자료로 들어갔었다. (7-1·7-2 와 같은 부분일치 계열)
const EXCLUDE_HREF = /help\.naver\.com|\/alias\//;
const BLOG_POST = /blog\.naver\.com\/[^/]+\/\d{6,}/;

export function filterAnchors(raw: RawAnchor[], type: "news" | "blog", topN: number): Source[] {
  const byUrl = new Map<string, Source>();
  for (const a of raw) {
    if (!a.href || EXCLUDE_HREF.test(a.href)) continue;
    if (type === "news" && !/news\.naver\.com|\/news\/|n\.news/.test(a.href)) continue;
    if (type === "blog" && !BLOG_POST.test(a.href)) continue; // 블로그 "홈" 링크를 걸러낸다
    // ⚠️ 스크린리더용 '새 창 열림'(11자)을 먼저 지워야 길이 필터가 의미가 있다 ('네이버뉴스새 창 열림' 같은 항목)
    const text = a.text.replace(/새 ?창 ?열림/g, "").replace(/\s+/g, " ").trim();
    if (text.length < 8 || NOISE.test(text)) continue;
    let summary = a.ctx.replace(/새 ?창 ?열림/g, "");
    if (text) summary = summary.split(text).join(" ");
    summary = summary.replace(/\s+/g, " ").trim().slice(0, 260);
    const url = a.href.split("#")[0];
    const prev = byUrl.get(url);
    // 같은 기사가 [제목 링크]+[본문 스니펫 링크]로 두 번 잡힌다 → URL 당 하나, 제목이 더 짧은 쪽(스니펫은 길고 문장형)
    if (!prev || text.length < prev.title.length)
      byUrl.set(url, { type, title: text, summary: prev && prev.summary.length > summary.length ? prev.summary : summary, url });
  }
  // 제목 앞 40자 키로 한 번 더 중복 제거
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of byUrl.values()) {
    const k = s.title.slice(0, 40);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= topN) break;
  }
  return out;
}

export async function scrapeTrends(
  keyword: string,
  topN: number,
  opts: { headless: boolean; log?: (m: string, level?: "info" | "warn") => void },
): Promise<Source[]> {
  const { browser, context } = await newContext({ headless: opts.headless, useNaverSession: false });
  try {
    const page = await context.newPage();
    const out: Source[] = [];
    for (const [type, url] of [
      ["news", NAVER.newsSearch(keyword)],
      ["blog", NAVER.blogSearch(keyword)],
    ] as const) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1200);
        const got = filterAnchors(await collectAnchors(page), type, topN);
        opts.log?.(`${type === "news" ? "뉴스" : "블로그"} ${got.length}건 수집`);
        out.push(...got);
      } catch (e) {
        const m = (e as Error).message || "";
        const why = /ERR_|net::|Timeout|timeout/.test(m) ? "네이버에 연결하지 못했습니다(인터넷 연결 확인)" : m.split("\n")[0].slice(0, 120);
        opts.log?.(`${type === "news" ? "뉴스" : "블로그"} 수집 실패 — ${why}`, "warn");
      }
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}
