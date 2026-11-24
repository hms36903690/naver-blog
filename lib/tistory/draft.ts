/**
 * 티스토리 반자동: 글쓰기 화면에 제목·본문을 채우고 "임시저장"까지만 한다.
 *
 * ⚠️ 발행은 절대 하지 않는다. 이 파일에는 발행(완료/공개발행) 버튼을 누르는 코드가 없고, 있어서도 안 된다.
 *   이미 애드센스 승인을 받은 블로그다 — 사람이 읽고 고친 뒤 직접 발행한다.
 * ⚠️ 셀렉터는 실측 전 후보값이다(lib/scrape/selectors.ts TISTORY). 사용자 PC 에서 diagnoseTistory() 로 잰다.
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Frame, Locator, Page } from "playwright";
import { ensureDirs, paths } from "../paths";
import { newContextWith } from "../playwright";
import { TISTORY } from "../scrape/selectors";
import type { Draft } from "../types";
import { draftToTistoryHtml } from "./html";
import { fmtUntil, refreshSessionFile, summarizeSessionFile } from "../sessionFile";
import { isTistoryLoginUrl, openTistoryWithRelogin, reloginFailMessage, tistorySessionPath } from "./session";

export type TistoryResult = {
  status: "draft_saved" | "draft_unverified" | "dry_run" | "failed";
  screenshot?: string;
  note: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function firstVisible(scope: Page | Frame, cands: readonly string[]): Promise<Locator | null> {
  for (const sel of cands) {
    try {
      const loc = scope.locator(sel).filter({ visible: true }).first();
      if ((await loc.count()) > 0) return loc;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

async function shot(page: Page, jobId: number, tag: string): Promise<string | undefined> {
  try {
    ensureDirs();
    const f = path.join(tag === "draft" ? paths.screenshots : paths.debug, `tistory-job${jobId}-${tag}-${Date.now()}.png`);
    await page.screenshot({ path: f, fullPage: true });
    return f;
  } catch {
    return undefined;
  }
}

/** 본문 넣기: ① tinymce API(setContent) ② 편집 iframe body 에 직접. 넣은 뒤 다시 읽어 확인한다. */
async function putBody(page: Page, html: string): Promise<{ ok: boolean; how: string }> {
  const viaApi = await page
    .evaluate((h) => {
      const t = (window as unknown as { tinymce?: { activeEditor?: { setContent: (x: string) => void; getContent: () => string; save?: () => void; fire?: (e: string) => void; setDirty?: (b: boolean) => void } } }).tinymce;
      const ed = t?.activeEditor;
      if (!ed) return -1;
      ed.setContent(h);
      ed.setDirty?.(true);
      ed.fire?.("change");
      ed.save?.();
      return ed.getContent().length;
    }, html)
    .catch(() => -1);
  if (viaApi > 20) return { ok: true, how: "tinymce" };

  for (const sel of TISTORY.editorFrame) {
    const el = await page.$(sel).catch(() => null);
    const f = el ? await el.contentFrame() : null;
    if (!f) continue;
    const len = await f
      .evaluate((h) => {
        document.body.innerHTML = h;
        document.body.dispatchEvent(new InputEvent("input", { bubbles: true }));
        return document.body.innerText.length;
      }, html)
      .catch(() => 0);
    if (len > 20) return { ok: true, how: `iframe ${sel}` };
  }
  return { ok: false, how: "none" };
}

export async function saveTistoryDraft(o: {
  jobId: number;
  blog: string;
  draft: Draft;
  images: Map<number, string>;
  dryRun: boolean;
  headless: boolean;
  log: (m: string, level?: "info" | "warn" | "error" | "ok") => void;
  harness?: { entryUrl: string; setup: (ctx: BrowserContext) => Promise<void> };
}): Promise<TistoryResult> {
  const { html, photoSlots } = draftToTistoryHtml(o.draft, o.images);
  const { browser, context } = await newContextWith({ headless: o.headless, storageState: o.harness ? undefined : tistorySessionPath() });
  try {
    if (o.harness) await o.harness.setup(context);
    const page = await context.newPage();
    // "저장된 글이 있습니다. 이어서 작성하시겠습니까?" 같은 확인창 → 취소(새 글로 시작)
    page.on("dialog", async (d) => {
      o.log(`티스토리 안내창을 닫았습니다: ${d.message().slice(0, 60)}`);
      await d.dismiss().catch(() => {});
    });
    if (o.harness) {
      await page.goto(o.harness.entryUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(3000);
    } else {
      const open = await openTistoryWithRelogin(page, TISTORY.newPost(o.blog));
      if (!open.ok) return { status: "failed", note: reloginFailMessage(open) };
      if (open.relogged) o.log("티스토리 로그인이 풀려 있어 카카오 로그인으로 자동으로 다시 들어갔습니다");
      await sleep(1500);
    }
    if (!o.harness) await refreshSessionFile(context, tistorySessionPath()); // 로그인 유지 확인 직후 연장된 쿠키 저장

    // 제목
    const title = await firstVisible(page, TISTORY.title);
    if (!title) {
      const s = await shot(page, o.jobId, "no-title");
      return { status: "failed", screenshot: s, note: "티스토리 글쓰기 화면에서 제목 칸을 찾지 못했습니다. 설정의 [티스토리 화면 점검]을 눌러 결과를 보내주세요." };
    }
    await title.click();
    await title.fill(o.draft.title);
    const gotTitle = await title.inputValue().catch(() => "");
    if (gotTitle.trim() !== o.draft.title.trim()) {
      const s = await shot(page, o.jobId, "title");
      return { status: "failed", screenshot: s, note: "제목이 제대로 들어가지 않아 중단했습니다." };
    }

    // 본문 — ⚠️ 본문을 못 넣었으면 저장하지 않는다(빈 글·제목만 있는 글이 임시저장되는 것을 막는다)
    const body = await putBody(page, html);
    if (!body.ok) {
      const s = await shot(page, o.jobId, "no-body");
      return { status: "failed", screenshot: s, note: "본문 편집기를 찾지 못해 저장하지 않았습니다. 설정의 [티스토리 화면 점검]을 눌러 결과를 보내주세요." };
    }
    o.log(`티스토리 본문을 넣었습니다${photoSlots ? ` — 사진 자리 ${photoSlots}곳은 안내문으로 표시했습니다` : ""}`);
    await sleep(1200);
    const screenshot = await shot(page, o.jobId, "draft");

    if (o.dryRun)
      return { status: "dry_run", screenshot, note: "연습 모드 — 티스토리에 임시저장하지 않았습니다. 완성 화면만 저장했습니다." };

    // 임시저장 — 저장 요청(POST) 또는 "저장" 안내 문구로 확인
    const btn = await firstVisible(page, TISTORY.draftSave);
    if (!btn) {
      const s = await shot(page, o.jobId, "no-draft-btn");
      return { status: "failed", screenshot: s ?? screenshot, note: "임시저장 버튼을 찾지 못했습니다. 설정의 [티스토리 화면 점검]을 눌러 결과를 보내주세요." };
    }
    const saved = page
      .waitForResponse((r) => r.request().method() === "POST" && /draft|temp|save/i.test(r.url()) && r.status() < 400, { timeout: 10000 })
      .then(() => "request")
      .catch(() => null);
    await btn.click({ timeout: 5000 });
    const toast = page
      .locator("text=/임시\\s*저장(되었|됐|완료)|저장되었습니다/")
      .first()
      .waitFor({ timeout: 10000 })
      .then(() => "toast")
      .catch(() => null);
    const signal = (await Promise.race([saved, toast])) ?? (await saved) ?? (await toast);
    await sleep(2000); // 저장이 끝날 시간을 준 뒤 닫는다
    const photoNote = photoSlots ? ` 사진 ${photoSlots}장은 앱의 [사진 폴더 열기]로 열어 노란 안내문 자리에 끌어다 넣어 주세요.` : "";
    if (signal)
      return {
        status: "draft_saved",
        screenshot,
        note: `티스토리에 임시저장했습니다. 발행은 하지 않았습니다 — 티스토리 글쓰기 화면의 '임시저장' 목록에서 불러와 읽어보고 직접 발행하세요.${photoNote}`,
      };
    return {
      status: "draft_unverified",
      screenshot,
      note: `임시저장 버튼은 눌렀지만 저장됐다는 신호를 확인하지 못했습니다. 티스토리 글쓰기 화면의 '임시저장' 목록에 이 글이 있는지 확인해 주세요.${photoNote}`,
    };
  } catch (e) {
    return { status: "failed", note: `티스토리 글쓰기 화면에서 문제가 생겼습니다: ${(e as Error).message.split("\n")[0].slice(0, 200)}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * [티스토리 화면 점검] — 사용자 PC 에서 살아 있는 글쓰기 화면을 재서(9장 6.5-b 와 같은 취지) 결과를 남긴다.
 * 아무것도 입력·저장하지 않는다. 결과 JSON 과 스크린샷은 data/debug 에 남는다.
 */
export async function diagnoseTistory(blog: string): Promise<{ summary: string[]; detail: unknown; file: string; screenshot?: string }> {
  ensureDirs();
  const { browser, context } = await newContextWith({ headless: true, storageState: tistorySessionPath() });
  const dialogs: string[] = [];
  try {
    const page = await context.newPage();
    page.on("dialog", async (d) => {
      dialogs.push(d.message().slice(0, 120));
      await d.dismiss().catch(() => {});
    });
    const open = await openTistoryWithRelogin(page, TISTORY.newPost(blog));
    await sleep(2000);
    const count = async (scope: Page | Frame, sels: readonly string[]) => {
      const r: Record<string, string> = {};
      for (const s of sels) {
        const n = await scope.locator(s).count().catch(() => -1);
        const v = n > 0 ? await scope.locator(s).filter({ visible: true }).count().catch(() => 0) : 0;
        r[s] = `${n}개(보임 ${v})`;
      }
      return r;
    };
    const detail = {
      url: page.url(),
      relogin: open.ok ? (open.relogged ? "카카오로 자동 재로그인함" : "필요 없었음") : `실패: ${open.reason}`,
      loginPageButtons: open.ok ? [] : open.loginButtons,
      cookieNames: summarizeSessionFile(tistorySessionPath(), /tistory\.com$|kakao\.com$/, []).names,
      dialogs,
      title: await count(page, TISTORY.title),
      editorFrame: await count(page, TISTORY.editorFrame),
      draftSave: await count(page, TISTORY.draftSave),
      page: await page
        .evaluate(() => ({
          tinymce: Boolean((window as unknown as { tinymce?: { activeEditor?: unknown } }).tinymce?.activeEditor),
          iframes: [...document.querySelectorAll("iframe")].map((f) => `${f.id}|${f.className}|${(f.getAttribute("src") || "").slice(0, 60)}`),
          textareas: [...document.querySelectorAll("textarea,input[type=text]")].map((t) => `${t.tagName}#${t.id}.${(t as HTMLElement).className}|${t.getAttribute("placeholder") || ""}`),
          // 버튼 목록 — 발행·임시저장·사진 계열이 실제로 어떤 이름인지 보기 위함(누르지 않는다)
          buttons: [...document.querySelectorAll("button,a[role=button],a.btn,a[class*='btn']")]
            .map((b) => `${b.tagName}#${b.id}.${String((b as HTMLElement).className).slice(0, 60)}|${((b as HTMLElement).innerText || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 30)}`)
            .filter((x) => /저장|발행|완료|공개|사진|이미지|첨부|파일|image|photo|draft|publish/i.test(x))
            .slice(0, 60),
        }))
        .catch((e) => ({ error: String(e) })),
    };
    const file = path.join(paths.debug, `tistory-diagnose-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(detail, null, 2));
    const screenshot = await shot(page, 0, "diagnose");
    const ok = (o: Record<string, string>) => Object.values(o).some((v) => /보임 [1-9]/.test(v));
    const p = detail.page as { tinymce?: boolean };
    const loggedIn = !isTistoryLoginUrl(detail.url);
    if (loggedIn) await refreshSessionFile(context, tistorySessionPath());
    const sum = summarizeSessionFile(tistorySessionPath(), /tistory\.com$/, [...TISTORY.sessionCookies]);
    const summary = [
      loggedIn ? `로그인: 됨 ✔${open.ok && open.relogged ? " (풀려 있던 것을 카카오 로그인으로 자동으로 다시 들어감)" : ""}` : open.ok ? "로그인: 풀려 있음 ✖" : `로그인: 풀려 있음 ✖ — ${open.reason === "need_password" ? "카카오도 비밀번호를 물음('로그인 상태 유지' 꺼짐)" : "자동 재로그인 실패"}`,
      (() => {
        const k = summarizeSessionFile(tistorySessionPath(), /kakao\.com$/, []);
        return !k.names.length
          ? "카카오 로그인 정보: 없음 ✖ — 티스토리가 풀리면 자동으로 다시 들어갈 수 없습니다"
          : k.sessionOnly
            ? "카카오 로그인 정보: 브라우저를 닫으면 끝나는 방식 ✖ — 카카오 '로그인 상태 유지'를 체크하고 다시 로그인하세요"
            : `카카오 로그인 정보: ${fmtUntil(k.until)}까지 ✔ (티스토리가 풀려도 자동으로 다시 들어갑니다)`;
      })(),
      sum.sessionOnly
        ? "로그인 정보 유지: 브라우저를 닫으면 끝나는 방식 ✖ — 카카오 '로그인 상태 유지'를 체크하고 다시 로그인하세요"
        : sum.until
          ? `로그인 정보 유지: ${fmtUntil(sum.until)}까지 ✔ (앱을 쓸 때마다 연장)`
          : "로그인 정보 유지: 확인 못 함",
      `제목 칸: ${ok(detail.title) ? "찾음 ✔" : "못 찾음 ✖"}`,
      `본문 편집기: ${p.tinymce ? "찾음 ✔" : ok(detail.editorFrame) ? "찾음(보조) ✔" : "못 찾음 ✖"}`,
      `임시저장 버튼: ${ok(detail.draftSave) ? "찾음 ✔" : "못 찾음 ✖"}`,
      dialogs.length ? `안내창 ${dialogs.length}개 닫음` : "안내창 없음",
    ];
    return { summary, detail, file, screenshot };
  } finally {
    await browser.close().catch(() => {});
  }
}
