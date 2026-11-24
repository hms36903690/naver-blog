/**
 * [네이버 화면 점검] — 명세 9장 6.5-b "살아 있는 에디터에 물어본다"를 앱 안에서 하는 도구.
 *
 * ⚠️ 진입 직후 한 번만 재면 안 된다 — 에디터 요소의 절반은 조건부로 생긴다(드롭다운·팔레트·사진·발행 레이어).
 *   그래서 3단계로 잰다:
 *   ① 진입 직후, 닫기 "전에": 복원 팝업·차단막·도움말
 *   ② 닫은 뒤 하나씩 열어 놓고: 문단서식 드롭다운 / 배경색 팔레트 / 사진 1장 / 발행 레이어
 *   ③ iframe 안/밖 양쪽에서 count + 보임 — 발행 버튼·공개범위 위치는 환경마다 다르다
 * ⚠️ 최종 발행(확정) 버튼은 절대 누르지 않는다. 공개범위 라디오도 누르지 않고 재기만 한다.
 * 결과(JSON·스크린샷)는 data/debug 에 남는다 — 사용자가 결과를 보내주면 selectors.ts 후보 배열 "앞"에 실측값을 추가한다.
 */
import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Frame, Page } from "playwright";
import { ensureDirs, paths } from "../paths";
import { newContext } from "../playwright";
import { EDITOR, NAVER } from "../scrape/selectors";
import { refreshSessionFile } from "../sessionFile";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Scope = Page | Frame;
type Count = { frame: string; page: string };

async function countIn(scope: Scope, sel: string): Promise<string> {
  const n = await scope.locator(sel).count().catch(() => -1);
  if (n <= 0) return n < 0 ? "오류" : "0";
  const v = await scope.locator(sel).filter({ visible: true }).count().catch(() => 0);
  return `${n}(보임 ${v})`;
}
async function measure(page: Page, frame: Frame, sels: readonly string[]): Promise<Record<string, Count>> {
  const out: Record<string, Count> = {};
  for (const s of sels) out[s] = { frame: await countIn(frame, s), page: await countIn(page, s) };
  return out;
}
const found = (m: Record<string, Count>) => Object.values(m).some((c) => /보임 [1-9]/.test(c.frame) || /보임 [1-9]/.test(c.page));
const where = (m: Record<string, Count>) =>
  Object.values(m).some((c) => /보임 [1-9]/.test(c.frame)) ? "글쓰기 화면 안" : Object.values(m).some((c) => /보임 [1-9]/.test(c.page)) ? "글쓰기 화면 밖" : "없음";

async function firstVisible(scopes: Scope[], sels: readonly string[]) {
  for (const sc of scopes)
    for (const s of sels) {
      const l = sc.locator(s).filter({ visible: true }).first();
      if ((await l.count().catch(() => 0)) > 0) return l;
    }
  return null;
}

/** 1×1 이 아닌 작은 PNG(업로드 시험용) — 경로 대신 버퍼로 넘긴다(N-1: 한글 경로 함정) */
const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC",
  "base64",
);

export async function diagnoseNaver(o: {
  blogId?: string;
  harness?: { entryUrl: string; setup: (ctx: BrowserContext) => Promise<void> };
}): Promise<{ summary: string[]; detail: Record<string, unknown>; file: string; screenshots: string[] }> {
  ensureDirs();
  const entry = o.harness?.entryUrl ?? (o.blogId ? NAVER.writeUrl(o.blogId) : null);
  if (!entry) throw new Error("블로그 주소를 알 수 없습니다. 네이버 로그인을 다시 해주세요.");
  const { browser, context } = await newContext({ headless: true, useNaverSession: !o.harness });
  const shots: string[] = [];
  const shot = async (page: Page, tag: string) => {
    const f = path.join(paths.debug, `naver-diagnose-${tag}-${Date.now()}.png`);
    await page.screenshot({ path: f, fullPage: true }).catch(() => {});
    shots.push(f);
  };
  const detail: Record<string, unknown> = {};
  try {
    if (o.harness) await o.harness.setup(context);
    const page = await context.newPage();
    let uploaded = false;
    page.on("filechooser", async (c) => {
      await c.setFiles({ name: "diagnose.png", mimeType: "image/png", buffer: TEST_PNG }).catch(() => {});
      uploaded = true;
    });
    const dialogs: string[] = [];
    page.on("dialog", async (d) => {
      dialogs.push(d.message().slice(0, 100));
      await d.dismiss().catch(() => {});
    });
    await page.goto(entry, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(3000);
    detail.url = page.url();
    if (/nid\.naver\.com/.test(page.url())) {
      return { summary: ["로그인: 풀려 있음 ✖ — [네이버 로그인]을 다시 해주세요"], detail, file: "", screenshots: shots };
    }
    if (!o.harness) await refreshSessionFile(context, paths.session);
    const fel = await page.waitForSelector(EDITOR.frame, { timeout: 30000 }).catch(() => null);
    const frame = fel ? await fel.contentFrame() : null;
    if (!frame) {
      await shot(page, "no-frame");
      return { summary: ["글쓰기 화면(에디터 틀)을 찾지 못했습니다 ✖"], detail, file: "", screenshots: shots };
    }
    await frame.locator([...EDITOR.title, ...EDITOR.restorePopup].join(",")).first().waitFor({ timeout: 20000 }).catch(() => {});
    await sleep(800);

    // ① 진입 직후, 닫기 전에
    detail.step1 = await measure(page, frame, [...EDITOR.restorePopup, ...EDITOR.restoreCancel, ...EDITOR.popupDim, ...EDITOR.helpPanel, ...EDITOR.helpClose]);
    await shot(page, "1-entry");

    // 닫기: 복원 팝업(취소=새 글) → 도움말 → 우측 도크
    const cancel = await firstVisible([frame, page], EDITOR.restoreCancel);
    if (cancel) await cancel.click({ timeout: 5000 }).catch(() => {});
    await sleep(700);
    for (const sel of [...EDITOR.helpClose, ...EDITOR.sidebarClose]) {
      const b = await firstVisible([frame, page], [sel]);
      if (b) await b.click({ timeout: 2000 }).catch(() => {});
    }
    await sleep(500);

    // ② 닫은 뒤 상시 요소
    detail.step2_base = await measure(page, frame, [
      ...EDITOR.title, ...EDITOR.body, ...EDITOR.imageButton, ...EDITOR.textFormatOpen, ...EDITOR.bold,
      ...EDITOR.bgColorOpen, ...EDITOR.dividerInsert, ...EDITOR.bottomToolbar, ...EDITOR.bottomSearchInput, ...EDITOR.content, ...EDITOR.popupDim,
    ]);

    // 제목·본문에 커서를 둬야 드롭다운이 의미 있다(글자는 넣지 않는다)
    const body = await firstVisible([frame], EDITOR.body);
    if (body) await body.click().catch(() => {});
    await sleep(300);

    // ② 문단서식 드롭다운 열어 놓고
    const fmt = await firstVisible([frame], EDITOR.textFormatOpen);
    if (fmt) {
      await fmt.click().catch(() => {});
      await sleep(500);
      detail.step2_format = await measure(page, frame, [...EDITOR.optHeading, ...EDITOR.optBody, ...EDITOR.optQuote]);
      await shot(page, "2-format");
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(300);
    }
    // ② 배경색 팔레트 열어 놓고
    const bg = await firstVisible([frame], EDITOR.bgColorOpen);
    if (bg) {
      await bg.click().catch(() => {});
      await sleep(500);
      detail.step2_palette = await measure(page, frame, [...EDITOR.bgColorYellow, ...EDITOR.bgColorNone]);
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(300);
    }
    // ② 사진 1장 넣어 놓고 — 캡션 0×0 → 컴포넌트 클릭 → se-is-on, 우측 도크 계열
    const imgBtn = await firstVisible([frame], EDITOR.imageButton);
    if (imgBtn) {
      await imgBtn.click().catch(() => {});
      const t0 = Date.now();
      while (!uploaded && Date.now() - t0 < 15000) await sleep(300);
      await sleep(3500);
      const cap = frame.locator(`${EDITOR.imageComponent[0]} ${EDITOR.caption[0]}`).last();
      const capBefore = await cap.getAttribute("class").catch(() => null);
      const boxBefore = await cap.boundingBox({ timeout: 800 }).catch(() => null);
      detail.step2_image_before = {
        uploaded,
        ...(await measure(page, frame, [...EDITOR.imageComponent, ...EDITOR.caption, ...EDITOR.sidebar, ...EDITOR.sidebarClose, ...EDITOR.helpClose])),
        captionClass: capBefore,
        captionSize: boxBefore ? `${Math.round(boxBefore.width)}×${Math.round(boxBefore.height)}` : "0×0/없음",
      };
      await shot(page, "2-image");
      const comp = frame.locator(EDITOR.imageComponent[0]).last();
      await comp.click({ timeout: 3000 }).catch(() => {});
      await sleep(800);
      detail.step2_image_after_click = { captionClass: await cap.getAttribute("class").catch(() => null) };
      for (const sel of [...EDITOR.sidebarClose, ...EDITOR.helpClose]) {
        const b = await firstVisible([frame, page], [sel]);
        if (b) await b.click({ timeout: 2000 }).catch(() => {});
      }
      await sleep(400);
    }
    // ② 발행 레이어 열어 놓고 — ⚠️ 확정 버튼은 누르지 않는다
    const pub = await firstVisible([frame, page], EDITOR.publishOpen);
    detail.step3_publishOpen = await measure(page, frame, EDITOR.publishOpen);
    if (pub) {
      await pub.click({ timeout: 5000 }).catch(() => {});
      await sleep(1500);
      const vis: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(EDITOR.visibility)) {
        vis[k] = {
          label: { frame: await countIn(frame, v.label), page: await countIn(page, v.label) },
          checked: {
            frame: await frame.locator(v.input).first().evaluate((e) => (e as HTMLInputElement).checked).catch(() => null),
            page: await page.locator(v.input).first().evaluate((e) => (e as HTMLInputElement).checked).catch(() => null),
          },
        };
      }
      detail.step3_visibility = vis;
      detail.step3_publishConfirm = await measure(page, frame, EDITOR.publishConfirm);
      await shot(page, "3-publish-layer");
      await page.keyboard.press("Escape").catch(() => {});
    }
    detail.dialogs = dialogs;
    detail.dump = await frame
      .evaluate(() => ({
        toolbar: [...document.querySelectorAll(".se-toolbar button")].slice(0, 40).map((b) => b.className.slice(0, 80)),
        overlays: [...document.querySelectorAll("[class*='panel'],[class*='layer'],[class*='sidebar'],[class*='popup']")]
          .filter((e) => e.getBoundingClientRect().width > 100)
          .slice(0, 20)
          .map((e) => String((e as HTMLElement).className).slice(0, 80)),
      }))
      .catch(() => null);

    const s2 = detail.step2_base as Record<string, Count>;
    const pick = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, s2[k]]));
    const fmtOk = detail.step2_format ? found(detail.step2_format as Record<string, Count>) : false;
    const palOk = detail.step2_palette ? found(detail.step2_palette as Record<string, Count>) : false;
    const imgB = detail.step2_image_before as { uploaded?: boolean } | undefined;
    const capAfter = (detail.step2_image_after_click as { captionClass?: string | null } | undefined)?.captionClass ?? "";
    const visD = detail.step3_visibility as Record<string, { label: Count; checked: { frame: boolean | null; page: boolean | null } }> | undefined;
    const priv = visD?.private;
    const privFound = priv ? /보임 [1-9]/.test(priv.label.frame) || /보임 [1-9]/.test(priv.label.page) : false;
    const defaultPublic = visD?.public && (visD.public.checked.frame || visD.public.checked.page);
    const summary = [
      "로그인: 됨 ✔",
      `제목 칸: ${found(pick(EDITOR.title)) ? "찾음 ✔" : "못 찾음 ✖"} · 본문 칸: ${found(pick(EDITOR.body)) ? "찾음 ✔" : "못 찾음 ✖"}`,
      `소제목·인용구 메뉴: ${fmtOk ? "찾음 ✔" : "못 찾음 ✖"} · 형광펜: ${palOk ? "찾음 ✔" : "못 찾음 ✖"} · 굵게: ${found(pick(EDITOR.bold)) ? "✔" : "✖"} · 구분선: ${found(pick(EDITOR.dividerInsert)) ? "✔" : "✖"}`,
      `사진 넣기: ${imgB?.uploaded ? "올라감 ✔" : "못 올림 ✖"} · 사진 설명칸 펼침: ${/se-is-on/.test(capAfter) ? "✔" : "✖"}`,
      `발행 버튼: ${pub ? `찾음 ✔ (${where(detail.step3_publishOpen as Record<string, Count>)})` : "못 찾음 ✖"}`,
      `공개 범위 '비공개' 고르기: ${privFound ? "찾음 ✔" : "못 찾음 ✖"}${defaultPublic ? " (네이버 기본값은 전체공개 — 앱이 매번 비공개로 바꿉니다)" : ""}`,
      `최종 발행 버튼: ${found((detail.step3_publishConfirm as Record<string, Count>) ?? {}) ? "찾음 ✔ (누르지 않았습니다)" : "못 찾음 ✖"}`,
    ];
    const file = path.join(paths.debug, `naver-diagnose-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(detail, null, 1));
    return { summary, detail, file, screenshots: shots };
  } finally {
    await browser.close().catch(() => {});
  }
}
