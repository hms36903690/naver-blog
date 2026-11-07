import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { crawlRejectReason, judgeCrawled } from "../ai/vision";
import { NAVER } from "./selectors";

export type CandidateResult = {
  srcUrl: string;
  site: "naver" | "google";
  localPath?: string;
  ok: boolean;
  reason: string;
};

async function collectImageUrls(page: Page, url: string, max: number): Promise<string[]> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);
  // lazy 로딩 유도
  await page.mouse.wheel(0, 2200);
  await page.waitForTimeout(1500);
  const urls = await page.evaluate(() =>
    [...document.querySelectorAll("img")]
      .filter((i) => (i as HTMLImageElement).naturalWidth >= 120)
      .map((i) => (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src)
      .filter((s) => /^https?:/.test(s)),
  );
  const seen = new Set<string>();
  return urls.filter((u) => !/sprite|logo|icon|blank|\.svg/i.test(u) && !seen.has(u) && seen.add(u)).slice(0, max);
}

/**
 * 한 자리(query)당: 네이버 이미지 검색 → 실패 시 구글 → 후보를 하나씩 다운로드 → AI 가 직접 보고 판정 → 첫 통과 채택.
 * ⚠️ 채택률은 생각보다 훨씬 낮다(한 실측에서 후보 3장이 전부 워터마크로 탈락).
 * 탈락한 후보도 전부 반환해 DB 에 사유와 함께 남긴다 — 필터가 동작하는지 사용자가 확인할 유일한 통로.
 */
export async function findImageForSlot(args: {
  context: BrowserContext;
  query: string;
  textContext: string;
  maxCandidates: number;
  outDir: string;
  slotIndex: number;
  onCandidate?: (c: CandidateResult) => void;
}): Promise<{ chosen?: CandidateResult; tried: CandidateResult[] }> {
  const tried: CandidateResult[] = [];
  const page = await args.context.newPage();
  try {
    for (const [site, url] of [
      ["naver", NAVER.imageSearch(args.query)],
      ["google", NAVER.googleImageSearch(args.query)],
    ] as const) {
      let urls: string[] = [];
      try {
        urls = await collectImageUrls(page, url, args.maxCandidates);
      } catch {
        urls = [];
      }
      if (!urls.length) continue;
      for (let i = 0; i < urls.length; i++) {
        const src = urls[i];
        let local: string | undefined;
        try {
          const res = await args.context.request.get(src, { timeout: 15000 });
          const buf = await res.body();
          if (!res.ok() || buf.length < 3000) continue; // 아이콘·깨진 이미지
          const ct = res.headers()["content-type"] || "";
          const ext = ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ".jpg";
          fs.mkdirSync(args.outDir, { recursive: true });
          local = path.join(args.outDir, `crawl-${args.slotIndex}-${site}-${i}${ext}`);
          fs.writeFileSync(local, buf);
        } catch {
          continue;
        }
        const v = await judgeCrawled(local, args.query, args.textContext);
        const c: CandidateResult = { srcUrl: src, site, localPath: local, ok: v.fit, reason: v.fit ? v.reason : crawlRejectReason(v) };
        tried.push(c);
        args.onCandidate?.(c);
        if (c.ok) return { chosen: c, tried };
        // 한도 초과면 더 돌려도 전부 실패 — 이 자리는 비운다
        if (/limit/i.test(c.reason) && c.reason.startsWith("판정 실패")) return { tried };
      }
      // 네이버에서 후보는 있었지만 전부 탈락 → 구글로
    }
    return { tried };
  } finally {
    await page.close().catch(() => {});
  }
}
