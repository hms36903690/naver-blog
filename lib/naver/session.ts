import fs from "node:fs";
import { newContext } from "../playwright";
import { ensureDirs, paths } from "../paths";
import { NAVER } from "../scrape/selectors";

export type SessionStatus =
  | { state: "none"; message: string }
  | { state: "valid"; blogId: string; message: string }
  | { state: "expired"; message: string }
  | { state: "write_expired"; blogId: string; message: string }
  | { state: "error"; message: string };

const g = globalThis as unknown as {
  __loginInFlight?: boolean;
  __sessionCache?: { at: number; value: SessionStatus };
};
const TTL = 5 * 60 * 1000;

export const hasSessionFile = () => fs.existsSync(paths.session);
export const isLoginInFlight = () => Boolean(g.__loginInFlight);
export function invalidateSessionCache() {
  g.__sessionCache = undefined;
}

/**
 * 네이버 로그인은 자동화하지 않는다(보안문자·2차인증). 창을 띄워 사용자가 직접 로그인하고,
 * NID_SES 쿠키가 생기면 storageState 를 저장해 재사용한다.
 */
export async function loginInteractive(): Promise<{ ok: boolean; message: string }> {
  if (g.__loginInFlight) return { ok: false, message: "이미 로그인 창이 열려 있습니다." };
  g.__loginInFlight = true;
  ensureDirs();
  const { browser, context } = await newContext({ headless: false, useNaverSession: false });
  try {
    const page = await context.newPage();
    await page.goto(NAVER.loginUrl, { waitUntil: "domcontentloaded" });
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      if (page.isClosed()) return { ok: false, message: "로그인 창이 닫혀서 중단했습니다." };
      const cookies = await context.cookies();
      if (cookies.some((c) => c.name === "NID_SES")) {
        // 쿠키 안정화를 위해 naver.com 에 한 번 들른 뒤 저장
        await page.goto("https://www.naver.com", { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.waitForTimeout(1500);
        await context.storageState({ path: paths.session });
        invalidateSessionCache();
        const keep = (await context.cookies()).find((c) => c.name === "NID_SES");
        // ⚠️ 7-10: expires=-1 이면 "로그인 상태 유지"가 꺼진 세션 쿠키 → 몇 시간 뒤 글쓰기만 막힌다
        const persistent = keep && keep.expires > 0;
        return {
          ok: true,
          message: persistent
            ? "로그인했습니다."
            : "로그인했습니다. 다만 '로그인 상태 유지'가 꺼져 있어 곧 다시 로그인해야 할 수 있습니다.",
        };
      }
      await page.waitForTimeout(1000);
    }
    return { ok: false, message: "5분 안에 로그인이 끝나지 않아 중단했습니다." };
  } catch (e) {
    const msg = (e as Error).message;
    if (/closed/i.test(msg)) return { ok: false, message: "로그인 창이 닫혀서 중단했습니다." };
    return { ok: false, message: `로그인 중 문제: ${msg.slice(0, 200)}` };
  } finally {
    g.__loginInFlight = false;
    await browser.close().catch(() => {});
  }
}

export function logout() {
  if (fs.existsSync(paths.session)) fs.unlinkSync(paths.session);
  invalidateSessionCache();
}

/**
 * ⚠️ 7-9: naver.com 에는 로그인 상태에서도 nidlogin 링크가 남아 있다 → 그걸로 판정하면 항상 "만료".
 *   blog.naver.com/MyBlog.naver 로 가서 로그인 페이지로 튕기는지로 판정한다.
 * ⚠️ 7-10: 읽기는 되는데 글쓰기만 만료된 상태가 실제로 있다 → 2단계로 글쓰기 페이지까지 열어 본다.
 */
export async function verifySession(force = false): Promise<SessionStatus> {
  if (!hasSessionFile()) return { state: "none", message: "로그인 정보가 없습니다." };
  if (!force && g.__sessionCache && Date.now() - g.__sessionCache.at < TTL) return g.__sessionCache.value;

  let value: SessionStatus;
  const { browser, context } = await newContext({ headless: true, useNaverSession: true });
  try {
    const page = await context.newPage();
    await page.goto(NAVER.myBlog, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);
    if (/nid\.naver\.com/.test(page.url())) {
      value = { state: "expired", message: "네이버 로그인이 풀렸습니다." };
    } else {
      const m = page.url().match(/blog\.naver\.com\/(?:PostList\.naver\?blogId=)?([A-Za-z0-9_-]+)/);
      let blogId = m && !/MyBlog/i.test(m[1]) ? m[1] : "";
      if (!blogId) {
        blogId =
          (await page
            .evaluate(() => {
              const f = document.querySelector("iframe#mainFrame") as HTMLIFrameElement | null;
              const src = f?.getAttribute("src") || "";
              const mm = src.match(/blogId=([A-Za-z0-9_-]+)/);
              return mm ? mm[1] : "";
            })
            .catch(() => "")) || "";
      }
      if (!blogId) value = { state: "error", message: "블로그 주소를 찾지 못했습니다." };
      else {
        await page.goto(NAVER.writeUrl(blogId), { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2000);
        if (/nid\.naver\.com/.test(page.url()))
          value = { state: "write_expired", blogId, message: "읽기는 되지만 글쓰기 로그인이 풀렸습니다." };
        else value = { state: "valid", blogId, message: "로그인되어 있습니다." };
      }
    }
  } catch (e) {
    value = { state: "error", message: `확인 실패: ${(e as Error).message.slice(0, 160)}` };
  } finally {
    await browser.close().catch(() => {});
  }
  g.__sessionCache = { at: Date.now(), value };
  return value;
}
