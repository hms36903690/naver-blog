/**
 * ★ 네이버 스마트에디터 ONE 자동화 — 이 프로젝트의 90%.
 *
 * 이 파일의 순서·대기·클릭 방식에는 전부 "왜"가 있다(⚠️ 주석). 정리·리팩터링하기 전에 명세 7장을 읽어라.
 * 셀렉터는 전부 lib/scrape/selectors.ts 에 있다 — 여기에 셀렉터 문자열을 흩뿌리지 마라.
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Frame, Locator, Page } from "playwright";
import { countPublishedToday, lastPublishedAt } from "../db";
import { ensureDirs, paths } from "../paths";
import { newContext } from "../playwright";
import { refreshSessionFile } from "../sessionFile";
import { EDITOR, NAVER } from "../scrape/selectors";
import type { Settings, Visibility } from "../settings";
import { HAS_VS16, neutralizeMarkdown, VS16_CLUSTER } from "../text";
import type { Draft } from "../types";

export type PublishStatus = "published" | "dry_run" | "failed" | "blocked";
export type PublishResult = { status: PublishStatus; url?: string; screenshot?: string; screenshots?: string[]; note: string };

export type PublishOptions = {
  jobId: number;
  draft: Draft;
  /** section index → 로컬 이미지 절대경로 */
  images: Map<number, string>;
  blogId?: string;
  dryRun: boolean;
  visibility: Visibility;
  headless: boolean;
  /** 유형별 모드(체험단·브랜딩): heading 도 인용구로 처리 */
  headingAsQuote?: boolean;
  log: (m: string, level?: "info" | "warn" | "error" | "ok") => void;
  /** ⚠️ 테스트 전용 — 로컬 하네스(9장 6.5-a)에 붙이기 위한 진입 주소와 컨텍스트 준비 훅 */
  harness?: { entryUrl: string; setup: (ctx: BrowserContext) => Promise<void> };
};

// ── 발행 가드 ────────────────────────────────────────────────────
/** 연습 모드가 아닐 때만 검사: kill-switch / 오늘 발행 수 ≥ 한도 / 마지막 발행 후 경과 < 최소 간격 */
export function checkPublishGuard(s: Settings, now = new Date()): { blocked: false } | { blocked: true; reason: string } {
  if (s.killSwitch) return { blocked: true, reason: "전체 중단이 켜져 있어 발행하지 않았습니다." };
  const today = countPublishedToday();
  if (today >= s.dailyPublishLimit)
    return { blocked: true, reason: `오늘 발행 한도(${s.dailyPublishLimit}편)에 도달했습니다. 설정에서 늘릴 수 있습니다.` };
  const last = lastPublishedAt();
  if (last && s.minPublishIntervalMin > 0) {
    const elapsedMin = (now.getTime() - last.getTime()) / 60000;
    if (elapsedMin < s.minPublishIntervalMin)
      return {
        blocked: true,
        reason: `마지막 발행 후 ${Math.floor(elapsedMin)}분 지났습니다. 최소 ${s.minPublishIntervalMin}분 간격을 지켜야 합니다.`,
      };
  }
  return { blocked: false };
}

// ── 공용 헬퍼 ────────────────────────────────────────────────────
type Scope = Page | Frame;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 후보 배열에서 위부터 isVisible 인 첫 번째. */
async function firstVisible(scope: Scope, cands: readonly string[]): Promise<Locator | null> {
  for (const sel of cands) {
    try {
      const loc = scope.locator(sel).filter({ visible: true }).first();
      if ((await loc.count()) > 0) return loc;
    } catch {
      /* 잘못된 셀렉터 문법 등 — 다음 후보 */
    }
  }
  return null;
}

/**
 * ⚠️ clickAnywhere 는 선택이 아니라 필수: 발행 버튼·공개 범위 라디오가 iframe 안/밖 어디 있는지는 환경마다 다르다
 * (명세 작성 환경=밖, 다른 구현자 환경=안). 반드시 두 곳을 모두 뒤진다. iframe 안 → 바깥 문서 순.
 */
async function clickAnywhere(page: Page, frame: Frame, cands: readonly string[]): Promise<"frame" | "page" | null> {
  for (const [where, scope] of [
    ["frame", frame],
    ["page", page],
  ] as const) {
    const loc = await firstVisible(scope, cands);
    if (loc) {
      await loc.click({ timeout: 5000 });
      return where;
    }
  }
  return null;
}

/** 진입부터 끝까지 한 발행 안에서만 쓰는 상태 */
class EditorSession {
  private bottomBarTop: number | null | undefined; // 한 번 재서 재사용(7-27). 뷰포트 바꾸면 무효화.
  constructor(
    readonly page: Page,
    readonly frame: Frame,
    readonly log: PublishOptions["log"],
  ) {}

  invalidateMeasurements() {
    this.bottomBarTop = undefined;
  }

  /** ⚠️ 7-25: VS16 클러스터만 insertText, 나머지는 keyboard.type. 문단 전체를 insertText 하면 글이 통째로 사라진다. */
  async typeText(raw: string, alreadyNeutral = false) {
    const text = alreadyNeutral ? raw : neutralizeMarkdown(raw);
    for (const part of text.split(VS16_CLUSTER)) {
      if (!part) continue;
      if (HAS_VS16.test(part)) await this.page.keyboard.insertText(part);
      else await this.page.keyboard.type(part, { delay: 7 });
    }
  }

  async click(cands: readonly string[]): Promise<boolean> {
    const loc = await firstVisible(this.frame, cands);
    if (!loc) return false;
    await loc.click({ timeout: 5000 });
    return true;
  }

  /** 문단 서식 드롭다운 → 옵션. 드롭다운 애니메이션 때문에 사이에 대기. */
  async setFormat(kind: "heading" | "body" | "quote"): Promise<boolean> {
    if (!(await this.click(EDITOR.textFormatOpen))) return false;
    await sleep(350);
    const opt = kind === "heading" ? EDITOR.optHeading : kind === "body" ? EDITOR.optBody : EDITOR.optQuote;
    const ok = await this.click(opt);
    await sleep(300);
    if (!ok) await this.page.keyboard.press("Escape").catch(() => {});
    return ok;
  }

  private async measureBottomBar(): Promise<number | null> {
    if (this.bottomBarTop !== undefined) return this.bottomBarTop;
    const loc = this.frame.locator(EDITOR.bottomToolbar[0]).first();
    // ⚠️ 7-27: boundingBox 는 요소가 없으면 기본 30초를 기다린다 → count 선검사 + timeout 800
    const box = (await loc.count()) > 0 ? await loc.boundingBox({ timeout: 800 }).catch(() => null) : null;
    this.bottomBarTop = box ? box.y : null;
    return this.bottomBarTop;
  }

  /**
   * ⚠️ 7-5: 인용구·구분선·캡션 같은 "컴포넌트" 안에서는 어떤 키로도 탈출되지 않는다
   *   (ArrowDown, Enter×2, Escape, Ctrl+End 전부 실패. 본문 서식을 적용하면 인용구가 통째로 평문으로 환원된다).
   *   유일한 해결: 마우스로 마지막 컴포넌트 "아래 빈 영역"을 클릭.
   * ⚠️ 7-6: y 를 아무렇게나 잡으면 하단 글감 검색바(.se-flayer-unified-toolbar-wrapper)를 눌러
   *   이후 캡션이 검색창에 타이핑된다 → 실측 위치로 클램프.
   */
  async exitToNewParagraph(): Promise<boolean> {
    const vh = this.page.viewportSize()?.height ?? 900;
    for (let round = 0; round < 3; round++) {
      const comps = this.frame.locator(EDITOR.contentComponents[0]);
      const n = await comps.count();
      if (!n) break;
      const lbox = await comps.nth(n - 1).boundingBox({ timeout: 800 }).catch(() => null);
      if (!lbox) break;
      const contentBox = await this.frame.locator(EDITOR.content[0]).first().boundingBox({ timeout: 800 }).catch(() => null);
      const canvasBottom = contentBox ? Math.min(vh, contentBox.y + Math.max(contentBox.height, 0) + 400) : vh;
      const barTop = await this.measureBottomBar();
      const maxY = Math.min(barTop != null ? barTop - 20 : vh - 150, canvasBottom - 20, vh - 20);
      const want = lbox.y + lbox.height + 30;
      if (want > maxY && round < 2) {
        // 아래 여백이 없으면 스크롤로 공간을 만든 뒤 다시 잰다
        await this.page.mouse.move(lbox.x + Math.min(lbox.width / 2, 200), Math.min(lbox.y + 10, vh - 200));
        await this.page.mouse.wheel(0, 250);
        await sleep(400);
        continue;
      }
      const y = Math.max(140, Math.min(want, maxY));
      const x = lbox.x + Math.min(lbox.width / 2, 300);
      await this.page.mouse.click(x, y);
      await sleep(350);
      return true;
    }
    this.log("문단 탈출 위치를 찾지 못했습니다(다음 문단이 앞 블록에 붙을 수 있음)", "warn");
    return false;
  }

  /** 7-6 확인용: 지금 포커스가 하단 글감 검색바에 있으면 true */
  async focusLeakedToBottomBar(): Promise<boolean> {
    const sels = EDITOR.bottomSearchInput.join(",");
    return this.frame
      .evaluate((s) => {
        const a = document.activeElement;
        return Boolean(a && (a.matches(s) || a.closest(".se-flayer-unified-toolbar-wrapper")));
      }, sels)
      .catch(() => false);
  }

  /** 커서가 제목이 아닌 본문 편집 영역에 있는가(7-26 확인) */
  async caretInBody(): Promise<boolean> {
    return this.frame
      .evaluate(
        ([titleSels, bodySels]) => {
          const sel = document.getSelection();
          const n = sel?.anchorNode;
          const el = n ? (n.nodeType === 1 ? (n as Element) : n.parentElement) : null;
          if (!el) return false;
          if (titleSels.some((s) => el.closest(s))) return false;
          return bodySels.some((s) => el.closest(s)) || Boolean((el as HTMLElement).isContentEditable);
        },
        [
          [...EDITOR.title, ".se-documentTitle", ".se-section-documentTitle"],
          [...EDITOR.body, ".se-text-paragraph"],
        ] as [string[], string[]],
      )
      .catch(() => false);
  }

  /** 도움말 패널 + 우측 도크 닫기. ⚠️ 7-21: 도크 계열이 환경마다 다르다 → 두 계열 모두, 없으면 Escape. */
  async closeOverlays(): Promise<string[]> {
    const closed: string[] = [];
    for (const scope of [this.frame, this.page] as Scope[]) {
      for (const sel of [...EDITOR.helpClose, ...EDITOR.sidebarClose]) {
        const loc = scope.locator(sel).filter({ visible: true });
        const n = await loc.count().catch(() => 0);
        for (let i = 0; i < n; i++) {
          try {
            await loc.first().click({ timeout: 2000 });
            closed.push(sel);
            await sleep(300);
          } catch {
            break;
          }
        }
      }
    }
    if (!closed.length) {
      const stillOpen = (await firstVisible(this.frame, [...EDITOR.helpPanel, ...EDITOR.sidebar])) != null;
      if (stillOpen) {
        await this.page.keyboard.press("Escape").catch(() => {});
        closed.push("Escape");
        await sleep(300);
      }
    }
    return closed;
  }
}

// ── 업로드: ⚠️ 7-7 파일 선택창 ─────────────────────────────────────
/**
 * ⚠️ 7-7 ★: page.waitForEvent("filechooser") 같은 일회성 리스너가 만료된 뒤 이미지 버튼을 누르면
 *   OS 네이티브 파일 대화상자가 떠서 브라우저가 영구히 멈춘다(실측 7분 정지, CPU 0%, 에러 없음). 맥·윈도우 공통.
 *   → 페이지를 열기 "전에" 영구 핸들러를 등록하고, 모듈 스코프 변수로 "지금 올릴 파일"을 넘긴다.
 */
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic" };
const pendingUpload = { path: null as string | null, done: false, error: null as string | null };

async function insertImage(ed: EditorSession, filePath: string, caption: string | null | undefined): Promise<{ ok: boolean; captioned: boolean }> {
  const before = await ed.frame.locator(EDITOR.imageComponent[0]).count();
  pendingUpload.path = filePath;
  pendingUpload.done = false;
  pendingUpload.error = null;
  const clicked = await ed.click(EDITOR.imageButton);
  if (!clicked) {
    pendingUpload.path = null;
    ed.log("사진 넣기 버튼을 찾지 못해 이 사진을 건너뜁니다", "warn");
    return { ok: false, captioned: false };
  }
  const t0 = Date.now();
  while (!pendingUpload.done && Date.now() - t0 < 20000) await sleep(200);
  pendingUpload.path = null;
  if (!pendingUpload.done) {
    ed.log("사진 올리기가 20초 안에 끝나지 않았습니다", "warn");
    return { ok: false, captioned: false };
  }
  if (pendingUpload.error) {
    ed.log(`사진 파일을 넘기지 못했습니다: ${pendingUpload.error}`, "warn");
    return { ok: false, captioned: false };
  }
  // 업로드 완료 후 컴포넌트가 생길 때까지(최대 20초) + 2.6초 안정화
  const t1 = Date.now();
  while ((await ed.frame.locator(EDITOR.imageComponent[0]).count()) <= before && Date.now() - t1 < 20000) await sleep(300);
  await sleep(2600);
  if ((await ed.frame.locator(EDITOR.imageComponent[0]).count()) <= before) {
    ed.log("사진이 본문에 나타나지 않았습니다", "warn");
    return { ok: false, captioned: false };
  }

  let captioned = false;
  const text = caption ? neutralizeMarkdown(caption).trim() : "";
  if (text) {
    // ⚠️ 7-18: 업로드 직후 .se-caption 은 DOM 에 있지만 0×0(isVisible=false). el.focus() 는 activeElement 를 안 바꿔 글자가 사라진다.
    //   방금 넣은(=마지막) 이미지 컴포넌트를 클릭해야 펼쳐지고 `se-is-on` 이 붙는다. 크기 숫자는 판정 기준으로 쓰지 않는다.
    const comp = ed.frame.locator(EDITOR.imageComponent[0]).last();
    await comp.click({ timeout: 5000 }).catch(() => {});
    const cap = comp.locator(EDITOR.caption[0]).first();
    const t2 = Date.now();
    let on = false;
    while (Date.now() - t2 < 3000) {
      const cls = (await cap.getAttribute("class").catch(() => null)) || "";
      if (/\bse-is-on\b/.test(cls) && (await cap.isVisible().catch(() => false))) {
        on = true;
        break;
      }
      await sleep(200);
    }
    if (on) {
      await cap.click({ timeout: 3000 }).catch(() => {});
      await sleep(200);
      if (await ed.focusLeakedToBottomBar()) {
        ed.log("캡션 입력 위치가 하단 검색창으로 새서 캡션을 생략합니다", "warn");
        await ed.page.keyboard.press("Escape").catch(() => {});
      } else {
        await ed.typeText(text, true);
        const cls = (await cap.getAttribute("class").catch(() => "")) || "";
        captioned = !/\bse-is-empty\b/.test(cls);
        if (!captioned) ed.log("사진 설명이 칸에 들어가지 않았습니다", "warn");
      }
    } else {
      // 폴백 ②: 캡션을 본문에 그냥 치면 본문 줄이 되고 다음 문단과 합쳐진다 → 넣는 것보다 빼는 게 낫다
      ed.log("사진 설명 칸이 열리지 않아 이 사진의 설명은 생략합니다", "warn");
    }
  }
  // 캡션도 컴포넌트 안이다 — 마우스 탈출을 해야 다음 문단이 캡션에 붙지 않는다(7-5)
  await ed.exitToNewParagraph();
  // 사진을 넣으면 우측 라이브러리 도크가 자동으로 열린다(7-21)
  await ed.closeOverlays();
  return { ok: true, captioned };
}

// ── 섹션 입력 ────────────────────────────────────────────────────
async function writeParagraph(ed: EditorSession, rawText: string, rawHighlight?: string | null) {
  const text = neutralizeMarkdown(rawText);
  const hl = rawHighlight ? neutralizeMarkdown(rawHighlight) : "";
  // 이중 방어(7-24): 타이핑 직전에도 indexOf 로 확인하고 못 찾으면 형광펜 생략
  const at = hl ? text.indexOf(hl) : -1;
  if (at < 0) {
    await ed.typeText(text, true);
  } else {
    await ed.typeText(text.slice(0, at), true);
    // 인라인 서식은 "클릭 이후 새로 입력되는 글자"에 적용된다(실측). 선택 후 적용이 아니다.
    let on = false;
    if (await ed.click(EDITOR.bgColorOpen)) {
      await sleep(350);
      on = await ed.click(EDITOR.bgColorYellow);
      await sleep(300);
      if (!on) await ed.page.keyboard.press("Escape").catch(() => {});
    }
    const boldOn = on && (await ed.click(EDITOR.bold));
    await sleep(250);
    await ed.typeText(hl, true);
    if (on) {
      if (await ed.click(EDITOR.bgColorOpen)) {
        await sleep(350);
        if (!(await ed.click(EDITOR.bgColorNone))) ed.log("형광펜 끄기 실패", "warn");
        await sleep(300);
      }
    }
    if (boldOn) {
      await ed.click(EDITOR.bold);
      await sleep(250);
    }
    await ed.typeText(text.slice(at + hl.length), true);
  }
  await ed.page.keyboard.press("Enter");
  await ed.page.keyboard.press("Enter");
}

async function writeQuote(ed: EditorSession, text: string) {
  // 툴바의 인용구 '컴포넌트 삽입' 대신: 텍스트 먼저 → Shift+Home 으로 그 줄 선택 → 문단 서식 인용구 (훨씬 안정적, 7-5)
  await ed.typeText(text);
  await ed.page.keyboard.press("Shift+Home");
  await sleep(150);
  if (!(await ed.setFormat("quote"))) {
    ed.log("인용구 서식을 찾지 못해 일반 문단으로 남깁니다", "warn");
    await ed.page.keyboard.press("End");
    await ed.page.keyboard.press("Enter");
    await ed.page.keyboard.press("Enter");
    return;
  }
  await ed.exitToNewParagraph();
}

async function writeHeading(ed: EditorSession, text: string) {
  if (!(await ed.setFormat("heading"))) {
    ed.log("소제목 서식을 찾지 못해 일반 문단으로 씁니다", "warn");
    await ed.typeText(text);
    await ed.page.keyboard.press("Enter");
    return;
  }
  await ed.typeText(text);
  await ed.page.keyboard.press("Enter");
  // 다음 줄은 본문 서식으로 복귀
  await ed.setFormat("body");
}

async function writeDivider(ed: EditorSession) {
  if (!(await ed.click(EDITOR.dividerInsert))) {
    ed.log("구분선 버튼을 찾지 못했습니다", "warn");
    return;
  }
  await sleep(500);
  await ed.exitToNewParagraph();
}

// ── 스크린샷: ⚠️ 7-20 ────────────────────────────────────────────
/**
 * ⚠️ 7-20: 에디터 iframe 문서는 뷰포트 높이를 그대로 따른다(scrollHeight === clientHeight === 900).
 *   fullPage:true 만으로는 마지막 한 화면만 담긴다. .se-content 의 scrollHeight 로 뷰포트를 키워 찍고 되돌린다.
 *   boundingBox().height 로 계산하지 마라 — 실측 761 vs 3637(5배).
 */
async function takeFullScreenshot(ed: EditorSession, base: string): Promise<{ files: string[]; partial: boolean }> {
  const { page, frame } = ed;
  const orig = page.viewportSize() ?? { width: 1366, height: 900 };
  const content = frame.locator(EDITOR.content[0]).first();
  const hasContent = (await content.count()) > 0;
  const sh = hasContent ? await content.evaluate((el) => (el as HTMLElement).scrollHeight).catch(() => null) : null;
  const cbox = hasContent ? await content.boundingBox({ timeout: 800 }).catch(() => null) : null;
  const files: string[] = [];
  try {
    if (sh && cbox) {
      const h = Math.min(9000, Math.ceil(cbox.y + sh + 160));
      await page.setViewportSize({ width: orig.width, height: Math.max(orig.height, h) });
      ed.invalidateMeasurements();
      await sleep(1200);
      // 폴백 ②: iframe 문서가 자체 스크롤을 갖는 환경이면 한 화면씩 나눠 찍는다
      const scroll = await frame
        .evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }))
        .catch(() => null);
      if (scroll && scroll.sh > scroll.ch + 20 && h >= 9000) {
        await frame.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
        let i = 1;
        for (let y = 0; y < scroll.sh && i <= 12; y += scroll.ch, i++) {
          await frame.evaluate((yy) => window.scrollTo(0, yy), y).catch(() => {});
          await sleep(400);
          const f = `${base}-${i}.png`;
          await page.screenshot({ path: f });
          files.push(f);
        }
        return { files, partial: false };
      }
      const f = `${base}.png`;
      await page.screenshot({ path: f, fullPage: true });
      files.push(f);
      return { files, partial: false };
    }
    const f = `${base}.png`;
    await page.screenshot({ path: f, fullPage: true });
    files.push(f);
    return { files, partial: true };
  } finally {
    await page.setViewportSize(orig).catch(() => {});
    ed.invalidateMeasurements();
  }
}

async function debugShot(page: Page, jobId: number, tag: string): Promise<string | undefined> {
  try {
    ensureDirs();
    const f = path.join(paths.debug, `job${jobId}-${tag}-${Date.now()}.png`);
    await page.screenshot({ path: f, fullPage: true });
    return f;
  } catch {
    return undefined;
  }
}

// ── 공개 범위: ⚠️ 7-19 ───────────────────────────────────────────
/**
 * ⚠️ 7-19: radio input 은 opacity:0(13×13) 이라 클릭되지 않는다. label(58×18)을 누르고 input.checked 를 직접 읽는다.
 *   네이버 발행 레이어의 기본값은 "전체공개". 확인되지 않으면 발행하지 말고 중단 — "일단 발행하고 나중에 바꾸자" 금지.
 */
async function selectVisibility(page: Page, frame: Frame, v: Visibility): Promise<{ ok: boolean; where?: string }> {
  const { label, input } = EDITOR.visibility[v];
  for (const [where, scope] of [
    ["frame", frame],
    ["page", page],
  ] as const) {
    const lab = scope.locator(label).filter({ visible: true }).first();
    if ((await lab.count().catch(() => 0)) === 0) continue;
    await lab.click({ timeout: 5000 });
    await sleep(300);
    const checked = await scope
      .locator(input)
      .first()
      .evaluate((el) => (el as HTMLInputElement).checked)
      .catch(() => false);
    return { ok: checked, where };
  }
  return { ok: false };
}

function findPostUrl(page: Page): string | null {
  for (const u of [page.url(), ...page.frames().map((f) => f.url())]) {
    const m = u.match(NAVER.postUrlRe);
    if (m) return `https://${m[0]}`;
  }
  // 보조: PostView.naver?blogId=…&logNo=… 형태
  for (const u of [page.url(), ...page.frames().map((f) => f.url())]) {
    const b = u.match(/blogId=([A-Za-z0-9_-]+)/);
    const l = u.match(/logNo=(\d{6,})/);
    if (b && l) return `https://blog.naver.com/${b[1]}/${l[1]}`;
  }
  return null;
}

// ── 메인 ─────────────────────────────────────────────────────────
export async function publishDraft(o: PublishOptions): Promise<PublishResult> {
  ensureDirs();
  const entry = o.harness?.entryUrl ?? (o.blogId ? NAVER.writeUrl(o.blogId) : null);
  if (!entry) return { status: "failed", note: "블로그 주소를 알 수 없습니다. 네이버 로그인을 다시 해주세요." };

  const { browser, context } = await newContext({ headless: o.headless, useNaverSession: !o.harness });
  try {
    if (o.harness) await o.harness.setup(context);
    const page = await context.newPage();

    // 1. filechooser 영구 핸들러 — 페이지 열기 "전에"(7-7)
    page.on("filechooser", async (c) => {
      try {
        // ⚠️ 경로를 넘기지 말고 "내용 + 영문 이름"으로 넘긴다.
        //   실측: 파일명(사진1.png)이든 폴더명(한글폴더/photo1.png)이든 경로에 한글이 있으면
        //   setFiles(경로)가 에러 없이 끝나지만 input 의 change 이벤트가 안 일어나 사진이 조용히 빠졌다.
        //   (틀린 추측: "업로드가 느린가" — 20초를 기다려도 change 0회. ASCII 경로로 바꾸면 즉시 1회.)
        //   윈도우 사용자 폴더(C:\Users\홍길동)·한글 사진 폴더에서 거의 확실히 밟는다.
        if (pendingUpload.path) {
          const ext = path.extname(pendingUpload.path).toLowerCase() || ".jpg";
          await c.setFiles({ name: `photo-${Date.now()}${ext}`, mimeType: MIME[ext] ?? "image/jpeg", buffer: fs.readFileSync(pendingUpload.path) });
        }
        else pendingUpload.error = "올릴 파일이 지정되지 않았습니다";
      } catch (e) {
        pendingUpload.error = ((e as Error).message || String(e)).split("\n")[0].slice(0, 200);
      } finally {
        pendingUpload.done = true;
      }
    });

    // 2. 에디터 진입, 2.5초 대기
    await page.goto(entry, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(2500);
    if (/nid\.naver\.com/.test(page.url()))
      return { status: "failed", note: "세션 만료 — 네이버 로그인이 풀렸습니다. 다시 로그인해 주세요(로그인 상태 유지 체크)." };
    if (!o.harness) await refreshSessionFile(context, paths.session); // 로그인 유지 확인 직후 연장된 쿠키 저장
    const frameEl = await page.waitForSelector(EDITOR.frame, { timeout: 30000 }).catch(() => null);
    const frame = frameEl ? await frameEl.contentFrame() : null;
    if (!frame) {
      const shot = await debugShot(page, o.jobId, "no-editor");
      return { status: "failed", screenshot: shot, note: "글쓰기 화면을 열지 못했습니다." };
    }
    await frame.waitForLoadState("domcontentloaded").catch(() => {});
    // 에디터 본체가 그려질 때까지
    await frame.locator([...EDITOR.title, ...EDITOR.restorePopup].join(",")).first().waitFor({ timeout: 20000 }).catch(() => {});
    await sleep(500);
    const ed = new EditorSession(page, frame, o.log);

    // 3. '작성 중인 글이 있습니다' 복원 팝업 → '취소'로 닫고 새 글 (⚠️ 7-1: 텍스트 부분일치 금지)
    const popup = await firstVisible(frame, EDITOR.restorePopup);
    if (popup) {
      const where = await clickAnywhere(page, frame, EDITOR.restoreCancel);
      await sleep(700);
      const still = await firstVisible(frame, EDITOR.restorePopup);
      const dim = await firstVisible(frame, EDITOR.popupDim);
      if (!where || still || dim) {
        const shot = await debugShot(page, o.jobId, "restore-popup");
        return { status: "failed", screenshot: shot, note: "'작성 중인 글' 안내창을 닫지 못해 중단했습니다. 글은 입력하지 않았습니다." };
      }
      o.log("이전에 쓰던 글 안내창을 닫고 새 글로 시작합니다");
    }

    // 4. 도움말/온보딩 패널 닫기 (⚠️ 7-4: 진입 직후 한 번, 발행 직전 한 번)
    await ed.closeOverlays();

    // 5. 제목 → 본문 클릭 → 섹션 순차 입력
    const title = await firstVisible(frame, EDITOR.title);
    if (!title) {
      const shot = await debugShot(page, o.jobId, "no-title");
      return { status: "failed", screenshot: shot, note: "제목 칸을 찾지 못했습니다." };
    }
    await title.click();
    await sleep(200);
    await ed.typeText(o.draft.title);
    await sleep(300);

    // ⚠️ 7-26: 본문을 못 찾았을 때 "Enter 치면 본문으로 가겠지" 하고 진행하면 글 전체가 제목 칸에 들어간다(에러 없이).
    //   Enter 로 한 번 더 시도하고, 그래도 본문 포커스가 확인되지 않으면 스크린샷을 남기고 즉시 실패.
    const bodyEl = await firstVisible(frame, EDITOR.body);
    if (bodyEl) await bodyEl.click();
    if (!(await ed.caretInBody())) {
      await page.keyboard.press("Enter");
      await sleep(400);
      if (!(await ed.caretInBody())) {
        const shot = await debugShot(page, o.jobId, "no-body");
        return {
          status: "failed",
          screenshot: shot,
          note: "본문 입력 칸을 찾지 못해 중단했습니다(글이 제목 칸에 들어가는 것을 막기 위해). 글은 임시저장 상태로 남아 있을 수 있습니다.",
        };
      }
    }

    let imgOk = 0;
    let imgSkip = 0;
    let capMiss = 0;
    const secs = o.draft.sections;
    for (let i = 0; i < secs.length; i++) {
      const s = secs[i];
      switch (s.type) {
        case "heading":
          if (o.headingAsQuote) await writeQuote(ed, s.text);
          else await writeHeading(ed, s.text);
          break;
        case "paragraph":
          await writeParagraph(ed, s.text, s.highlight);
          break;
        case "quote":
          await writeQuote(ed, s.text);
          break;
        case "divider":
          await writeDivider(ed);
          break;
        case "image": {
          const file = o.images.get(i);
          if (!file || !fs.existsSync(file)) {
            imgSkip++;
            break;
          }
          const r = await insertImage(ed, file, s.caption);
          if (r.ok) {
            imgOk++;
            if (s.caption && !r.captioned) capMiss++;
          } else imgSkip++;
          break;
        }
      }
      if (await ed.focusLeakedToBottomBar()) {
        o.log("입력 위치가 하단 검색창으로 샜습니다 — 본문으로 되돌립니다", "warn");
        await page.keyboard.press("Escape").catch(() => {});
        await ed.exitToNewParagraph();
      }
      if ((i + 1) % 5 === 0) o.log(`본문 입력 중… ${i + 1}/${secs.length}`);
    }
    o.log(`본문 입력 완료 — 사진 ${imgOk}장 넣음${imgSkip ? `, ${imgSkip}자리 비움` : ""}${capMiss ? `, 사진 설명 ${capMiss}개 생략` : ""}`);

    // 6. 도움말 + 오버레이 도크 닫기 ← 스크린샷 "앞"
    await ed.closeOverlays();

    // 7. 발행 직전 전체 스크린샷
    const base = path.join(paths.screenshots, `job${o.jobId}-${Date.now()}`);
    const shot = await takeFullScreenshot(ed, base);
    if (shot.partial) o.log("스크린샷이 일부만 담겼습니다(글 길이를 재지 못함)", "warn");

    // 8. 연습 모드면 여기서 종료
    if (o.dryRun) {
      return {
        status: "dry_run",
        screenshot: shot.files[0],
        screenshots: shot.files,
        note: `연습 모드 — 발행하지 않았습니다. 사진 ${imgOk}장${imgSkip ? `(빈 자리 ${imgSkip})` : ""}. (네이버가 작성 중인 글을 자동 임시저장했을 수 있습니다.)`,
      };
    }

    // 9. 다시 한 번 닫기 ← 스크린샷 "뒤" (그 사이 다시 열렸을 수 있다)
    await ed.closeOverlays();

    // 10. 발행 버튼 (⚠️ 7-2: 데이터 속성. ⚠️ 7-3: 차단막이 남아 있으면 클릭이 조용히 무시된다)
    if (await firstVisible(frame, EDITOR.popupDim)) {
      const s2 = await debugShot(page, o.jobId, "dim");
      return { status: "failed", screenshot: s2, note: "화면을 가리는 안내창이 남아 있어 발행하지 않았습니다. 글은 임시저장 상태로 남아 있을 수 있습니다." };
    }
    const openWhere = await clickAnywhere(page, frame, EDITOR.publishOpen);
    if (!openWhere) {
      const s2 = await debugShot(page, o.jobId, "no-publish-btn");
      return { status: "failed", screenshot: s2, note: "발행 버튼을 찾지 못했습니다. 글은 임시저장 상태로 남아 있을 수 있습니다." };
    }
    await sleep(1500);

    // 11. 공개 범위 선택 + input.checked 확인 ← 빠뜨리면 전체공개로 나간다
    const vis = await selectVisibility(page, frame, o.visibility);
    if (!vis.ok) {
      const s2 = await debugShot(page, o.jobId, "visibility");
      return {
        status: "failed",
        screenshot: s2,
        note: "공개 범위를 확인할 수 없어 발행하지 않고 중단했습니다. 글은 임시저장 상태로 남아 있습니다.",
      };
    }
    o.log(`공개 범위 확인됨`);

    // 12. 최종 확인 버튼
    const confirmWhere = await clickAnywhere(page, frame, EDITOR.publishConfirm);
    if (!confirmWhere) {
      const s2 = await debugShot(page, o.jobId, "no-confirm");
      return { status: "failed", screenshot: s2, note: "최종 발행 버튼을 찾지 못했습니다. 글은 임시저장 상태로 남아 있습니다." };
    }

    // 13. 실제 발행 검증 — ⚠️ 7-11: 게시글 주소로 이동해야 진짜 발행. 버튼을 눌렀다는 건 발행됐다는 뜻이 아니다.
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const u = findPostUrl(page);
      if (u) return { status: "published", url: u, screenshot: shot.files[0], screenshots: shot.files, note: "발행했습니다." };
      await sleep(500);
    }
    const s3 = await debugShot(page, o.jobId, "not-published");
    return {
      status: "failed",
      screenshot: s3 ?? shot.files[0],
      note: "발행 버튼을 눌렀지만 게시글 주소로 바뀌지 않았습니다. 글은 임시저장 상태로 남아 있습니다.",
    };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    return { status: "failed", note: `글쓰기 화면에서 문제가 생겼습니다: ${msg.split("\n")[0].slice(0, 200)}` };
  } finally {
    pendingUpload.path = null;
    await browser.close().catch(() => {});
  }
}
