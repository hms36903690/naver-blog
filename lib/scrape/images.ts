import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { crawlRejectReason, judgeCrawled } from "../ai/vision";
import { detectImage, extFor } from "../imageType";
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
/**
 * AI 에게 보여주기 전에 거를 것 — 실측(사용자 PC, 건강 키워드): 탈락 47장 중 대부분이 Getty·gettyimagesBank 등
 * 유료 스톡 워터마크였고, 네이버 이미지 검색의 "N pay 이벤트" 광고 배너가 여러 자리에서 반복해 AI 판정을 낭비했다.
 * 네이버 썸네일 주소는 원본 주소를 src= 에 인코딩해 담으므로 디코딩한 뒤 검사한다.
 */
const STOCK_RE =
  /gettyimages|istockphoto|shutterstock|123rf|dreamstime|alamy|depositphotos|stock\.adobe|adobestock|freepik|vecteezy|pngtree|clipartkorea|imagetoday|utoimage|multibits|bigstockphoto|canstockphoto/i;

export function isStockUrl(u: string): boolean {
  let x = u;
  for (let i = 0; i < 3; i++) {
    try {
      const d = decodeURIComponent(x);
      if (d === x) break;
      x = d;
    } catch {
      break;
    }
  }
  return STOCK_RE.test(x);
}

/** 한 작업 안에서 이미 본 사진(내용 해시) — 탈락한 같은 사진을 다시 판정하지 않고, 채택한 사진을 두 번 쓰지 않는다 */
export type SeenImages = Map<string, "chosen" | "rejected">;

export async function findImageForSlot(args: {
  context: BrowserContext;
  query: string;
  textContext: string;
  maxCandidates: number;
  outDir: string;
  slotIndex: number;
  onCandidate?: (c: CandidateResult) => void;
  seen?: SeenImages;
}): Promise<{ chosen?: CandidateResult; tried: CandidateResult[]; skipped: number }> {
  let skipped = 0;
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
        if (isStockUrl(src)) {
          skipped++; // 유료 스톡 — 다운로드도 AI 판정도 하지 않는다
          continue;
        }
        let local: string | undefined;
        let hash = "";
        try {
          const res = await args.context.request.get(src, { timeout: 15000 });
          const buf = await res.body();
          if (!res.ok() || buf.length < 3000) continue; // 아이콘·깨진 이미지
          hash = createHash("sha1").update(buf).digest("hex");
          if (args.seen?.has(hash)) {
            skipped++; // 같은 광고 배너 등 이미 본 사진
            continue;
          }
          const ct = res.headers()["content-type"] || "";
          void ct;
          const kind = detectImage(buf);
          if (kind === "unknown") continue; // 이미지가 아니거나 알 수 없는 형식
          const ext = extFor(kind);
          fs.mkdirSync(args.outDir, { recursive: true });
          local = path.join(args.outDir, `crawl-${args.slotIndex}-${site}-${i}${ext}`);
          fs.writeFileSync(local, buf);
        } catch {
          continue;
        }
        const v = await judgeCrawled(local, args.query, args.textContext);
        const c: CandidateResult = { srcUrl: src, site, localPath: local, ok: v.fit, reason: v.fit ? v.reason : crawlRejectReason(v) };
        if (hash && !v.reason.startsWith("판정 실패")) args.seen?.set(hash, c.ok ? "chosen" : "rejected");
        tried.push(c);
        args.onCandidate?.(c);
        if (c.ok) return { chosen: c, tried, skipped };
        // 한도 초과면 더 돌려도 전부 실패 — 이 자리는 비운다
        if (/limit/i.test(c.reason) && c.reason.startsWith("판정 실패")) return { tried, skipped };
      }
      // 네이버에서 후보는 있었지만 전부 탈락 → 구글로
    }
    return { tried, skipped };
  } finally {
    await page.close().catch(() => {});
  }
}
