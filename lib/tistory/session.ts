import fs from "node:fs";
import type { Page } from "playwright";
import path from "node:path";
import { newContextWith } from "../playwright";
import { fmtUntil, refreshSessionFile, summarizeSessionFile } from "../sessionFile";
import { ensureDirs, paths } from "../paths";
import { TISTORY } from "../scrape/selectors";
import { getSettings } from "../settings";

export const tistorySessionPath = () => path.join(paths.root, "tistory-session.json");

export type TistoryStatus =
  | { state: "no_blog"; message: string }
  | { state: "none"; message: string; blog: string }
  | { state: "valid"; message: string; blog: string }
  | { state: "expired"; message: string; blog: string }
  | { state: "error"; message: string; blog: string };

const g = globalThis as unknown as { __tsLogin?: boolean; __tsCache?: { at: number; key: string; v: TistoryStatus } };
export const isTistoryLoginInFlight = () => Boolean(g.__tsLogin);
export function invalidateTistoryCache() {
  g.__tsCache = undefined;
}

/** 카카오 로그인은 자동화하지 않는다 — 창을 띄우고 사람이 로그인한다. */
export async function tistoryLogin(): Promise<{ ok: boolean; message: string }> {
  if (g.__tsLogin) return { ok: false, message: "이미 티스토리 로그인 창이 열려 있습니다." };
  g.__tsLogin = true;
  ensureDirs();
  const { browser, context } = await newContextWith({ headless: false });
  try {
    const page = await context.newPage();
    await page.goto(TISTORY.loginUrl, { waitUntil: "domcontentloaded" });
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      if (page.isClosed()) return { ok: false, message: "로그인 창이 닫혀서 중단했습니다." };
      const cookies = await context.cookies();
      const hasCookie = cookies.some((c) => (TISTORY.sessionCookies as readonly string[]).includes(c.name));
      // 실측 전 보조 판정: 카카오 로그인 후 tistory.com 의 로그인 페이지가 아닌 곳으로 돌아오면 성공
      const u = page.url();
      const back = isTistoryInside(u) && cookies.some((c) => /tistory\.com$/.test(c.domain));
      if (hasCookie || back) {
        // 리다이렉트 중간에 저장하면 로그인 쿠키가 덜 들어간다 → 티스토리 첫 화면에 한 번 들러 쿠키를 안정화한 뒤 저장
        await page.waitForTimeout(2000);
        await page.goto(TISTORY.home, { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.waitForTimeout(2500);
        await refreshSessionFile(context, tistorySessionPath());
        invalidateTistoryCache();
        const sum = summarizeSessionFile(tistorySessionPath(), /tistory\.com$/, [...TISTORY.sessionCookies]);
        return {
          ok: true,
          message: sum.sessionOnly
            ? "티스토리에 로그인했습니다. 다만 '로그인 상태 유지'가 꺼져 있어 곧 풀릴 수 있습니다. 카카오 로그인 화면에서 체크하고 다시 로그인하시길 권합니다."
            : `티스토리에 로그인했습니다.${sum.until ? ` (로그인 정보 유지: ${fmtUntil(sum.until)}까지, 앱을 쓸 때마다 연장됩니다)` : ""}`,
        };
      }
      await page.waitForTimeout(1000);
    }
    return { ok: false, message: "5분 안에 로그인이 끝나지 않아 중단했습니다." };
  } catch (e) {
    const m = (e as Error).message;
    return { ok: false, message: /closed/i.test(m) ? "로그인 창이 닫혀서 중단했습니다." : `로그인 중 문제: ${m.split("\n")[0].slice(0, 160)}` };
  } finally {
    g.__tsLogin = false;
    await browser.close().catch(() => {});
  }
}

export function tistoryLogout() {
  if (fs.existsSync(tistorySessionPath())) fs.unlinkSync(tistorySessionPath());
  invalidateTistoryCache();
}

/** 글쓰기 페이지를 열어 로그인 화면으로 튕기는지로 판정(네이버 7-10 과 같은 원리: 쓰기까지 열어 본다). */
export async function verifyTistory(force = false): Promise<TistoryStatus> {
  const blog = getSettings().tistoryBlog;
  if (!blog) return { state: "no_blog", message: "설정에서 티스토리 주소를 넣어주세요." };
  if (!fs.existsSync(tistorySessionPath())) return { state: "none", blog, message: "티스토리 로그인이 필요합니다." };
  if (!force && g.__tsCache && g.__tsCache.key === blog && Date.now() - g.__tsCache.at < 5 * 60 * 1000) return g.__tsCache.v;
  let v: TistoryStatus;
  const { browser, context } = await newContextWith({ headless: true, storageState: tistorySessionPath() });
  try {
    const page = await context.newPage();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    const open = await openTistoryWithRelogin(page, TISTORY.newPost(blog));
    const u = page.url();
    if (!open.ok) v = { state: "expired", blog, message: reloginFailMessage(open) };
    else if (!u.includes(`${blog}.tistory.com`)) v = { state: "error", blog, message: "그 주소의 블로그 글쓰기 화면이 열리지 않습니다. 티스토리 주소를 확인해 주세요." };
    else {
      v = { state: "valid", blog, message: open.relogged ? "로그인되어 있습니다(카카오 로그인으로 자동으로 다시 들어갔습니다)." : "로그인되어 있습니다." };
      await refreshSessionFile(context, tistorySessionPath()); // 사이트가 연장해 준 쿠키를 저장(계속 풀리던 원인)
    }
  } catch (e) {
    v = { state: "error", blog, message: `확인 실패: ${(e as Error).message.split("\n")[0].slice(0, 140)}` };
  } finally {
    await browser.close().catch(() => {});
  }
  g.__tsCache = { at: Date.now(), key: blog, v };
  return v;
}

/**
 * 주소의 "사이트 이름(호스트)"으로만 판정한다.
 * ⚠️ 실측: 카카오 로그인 주소에는 돌아갈 곳(redirect_uri=…www.tistory.com…)이 글자 그대로 들어 있어,
 *   주소 전체에 /tistory\.com/ 정규식을 쓰면 카카오 화면을 "티스토리로 돌아왔다"고 착각했다.
 */
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};
const pathOf = (u: string) => {
  try {
    return new URL(u).pathname;
  } catch {
    return "";
  }
};
export const isKakaoUrl = (u: string) => /(^|\.)kakao\.com$/.test(hostOf(u));
export const isTistoryLoginUrl = (u: string) => (/(^|\.)tistory\.com$/.test(hostOf(u)) && pathOf(u).startsWith("/auth/")) || isKakaoUrl(u);
const isTistoryInside = (u: string) => /(^|\.)tistory\.com$/.test(hostOf(u)) && !pathOf(u).startsWith("/auth/");

export type OpenResult = { ok: true; relogged: boolean } | { ok: false; reason: "need_password" | "no_button" | "not_back"; loginButtons: string[] };

/**
 * 글쓰기 화면을 열되, 티스토리 로그인 화면으로 튕기면 "카카오계정으로 로그인"을 한 번 눌러 조용히 다시 들어가 본다.
 * ⚠️ 원인 가설(사용자: "몇 번 로그인해도 계속 풀린다"): 티스토리 자체 세션은 짧고, 평소 브라우저는 카카오에 남은 로그인으로
 *   버튼 한 번에 다시 들어가서 풀린 줄 모른다. 앱은 그 순간을 "풀림"으로 보고 멈췄다.
 * 비밀번호는 절대 넣지 않는다(로그인 자동화 금지 — 명세 2-4). 카카오가 비밀번호를 물으면 need_password 로 멈춘다.
 */
export async function openTistoryWithRelogin(page: Page, url: string): Promise<OpenResult> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  if (!isTistoryLoginUrl(page.url())) return { ok: true, relogged: false };

  const loginButtons = await page
    .evaluate(() =>
      [...document.querySelectorAll("a,button")]
        .map((b) => `${b.tagName}.${String((b as HTMLElement).className).slice(0, 40)}|${((b as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 20)}`)
        .filter((x) => /카카오|kakao|로그인/i.test(x))
        .slice(0, 15),
    )
    .catch(() => [] as string[]);

  let clicked = false;
  if (!isKakaoUrl(page.url())) {
    for (const sel of TISTORY.kakaoLoginButton) {
      const b = page.locator(sel).filter({ visible: true }).first();
      if ((await b.count().catch(() => 0)) > 0) {
        await b.click({ timeout: 5000 }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) return { ok: false, reason: "no_button", loginButtons };
  }
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(700);
    const u = page.url();
    if (isTistoryInside(u)) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2000);
      if (!isTistoryLoginUrl(page.url())) return { ok: true, relogged: true };
      return { ok: false, reason: "not_back", loginButtons };
    }
    // 카카오가 비밀번호를 물으면 — 여기서 멈춘다(입력하지 않는다)
    if (isKakaoUrl(u) && (await page.locator("input[type=password]").filter({ visible: true }).count().catch(() => 0)) > 0)
      return { ok: false, reason: "need_password", loginButtons };
  }
  return { ok: false, reason: "not_back", loginButtons };
}

export const reloginFailMessage = (r: Exclude<OpenResult, { ok: true }>) =>
  r.reason === "need_password"
    ? "티스토리 로그인이 풀렸고, 카카오 로그인도 남아 있지 않아 비밀번호가 필요합니다. [티스토리 로그인]을 누르고 카카오 화면에서 '로그인 상태 유지'를 꼭 체크해 주세요."
    : "티스토리 로그인이 풀렸습니다(자동으로 다시 들어가지 못했습니다). [티스토리 로그인]을 다시 눌러주세요.";
