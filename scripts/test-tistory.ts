/**
 * 티스토리 반자동 — 계정 없이 확인 가능한 것.
 * ⚠️ 하네스는 실제 티스토리 화면이 아니다. 셀렉터는 사용자 PC 의 [티스토리 화면 점검]으로 실측해야 한다.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserContext } from "playwright";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-ts-"));
process.env.DATA_DIR = tmp;
const H = path.join(process.cwd(), "scripts", "harness", "tistory.html");
let fail = 0;
const ok = (n: string, c: boolean, e = "") => (console.log(`${c ? "✔" : "✖"} ${n}${e ? "  — " + e : ""}`), c || fail++);

let saveReq = 0;
let lastState: any = null;
const setup = async (ctx: BrowserContext) => {
  saveReq = 0;
  await ctx.route("https://harnessblog.tistory.com/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/manage/drafts")) {
      saveReq++;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fs.readFileSync(H) });
  });
  ctx.on("page", (p) => {
    const orig = p.close.bind(p);
    p.on("close", () => {});
    // 브라우저가 닫히기 전 상태를 남긴다(스크린샷 시점마다 갱신)
    const shot = p.screenshot.bind(p);
    (p as any).screenshot = async (o: any) => {
      lastState = await p.evaluate(() => ({
        publish: (window as any).__publishClicks,
        saved: (window as any).__saved,
        title: (document.getElementById("post-title-inp") as HTMLTextAreaElement).value,
        body: (document.getElementById("editor-tistory_ifr") as HTMLIFrameElement).contentDocument!.body.innerHTML,
      })).catch(() => null);
      return shot(o);
    };
    void orig;
  });
};

(async () => {
  const { draftToTistoryHtml } = await import("@/lib/tistory/html");
  const { normalizeTistoryBlog } = await import("@/lib/settings");
  const { saveTistoryDraft } = await import("@/lib/tistory/draft");

  // ── 주소 정리 ──
  ok("주소 정리: https://MyBlog.tistory.com/manage → myblog", normalizeTistoryBlog("https://MyBlog.tistory.com/manage") === "myblog");
  ok("주소 정리: myblog.tistory.com → myblog", normalizeTistoryBlog("myblog.tistory.com") === "myblog");
  ok("주소 형식 오류는 거절", normalizeTistoryBlog("내 블로그!") === null);

  // ── HTML 변환 ──
  const draft = {
    title: "홈카페 그라인더 고르는 법",
    sections: [
      { type: "paragraph" as const, text: "결론부터: 그라인더가 맛을 좌우합니다 <script>x</script>", highlight: "그라인더가 맛을 좌우" },
      { type: "heading" as const, text: "핸드 vs 전동" },
      { type: "paragraph" as const, text: "**굵게** ~~취소~~ 물결~", highlight: "본문에 없는 말" },
      { type: "image" as const, query: "그라인더", caption: "제가 쓰는 그라인더" },
      { type: "image" as const, query: "못 구한 사진" },
      { type: "quote" as const, text: "인용" },
      { type: "divider" as const },
      { type: "heading" as const, text: "자주 묻는 질문" },
      { type: "paragraph" as const, text: "Q. 입문용은? A. 핸드 그라인더면 충분합니다." },
    ],
  };
  const imgs = new Map([[3, "/x/a.png"]]);
  const { html, photoSlots } = draftToTistoryHtml(draft, imgs);
  ok("소제목은 h2", (html.match(/<h2>/g) || []).length === 2);
  ok("강조는 같은 문단 안에서만 <b>", html.includes("<b>그라인더가 맛을 좌우</b>") && !html.includes("본문에 없는 말"));
  ok("HTML 태그 이스케이프", html.includes("&lt;script&gt;") && !html.includes("<script>"));
  ok("마크다운 무력화", !/\*\*|~~/.test(html) && html.includes("물결～"));
  ok("사진 자리: 구한 사진만 안내문 1개", photoSlots === 1 && html.includes("사진 1 — 제가 쓰는 그라인더") && !html.includes("못 구한 사진"));

  // ── 하네스: 연습 모드(저장 안 함) ──
  const logs: string[] = [];
  const base = { jobId: 1, blog: "harnessblog", draft, images: imgs, headless: true, log: (m: string) => logs.push(m) };
  const r1 = await saveTistoryDraft({ ...base, dryRun: true, harness: { entryUrl: "https://harnessblog.tistory.com/manage/newpost/", setup } });
  ok("연습 모드: dry_run, 저장 요청 0", r1.status === "dry_run" && saveReq === 0, r1.note);
  ok("이어쓰기 확인창은 취소(새 글) — 제목이 새 제목", lastState?.title === draft.title, lastState?.title);
  ok("본문이 편집기에 들어감", typeof lastState?.body === "string" && lastState.body.includes("<h2>핸드 vs 전동</h2>"));

  // ── 하네스: 임시저장 ──
  const r2 = await saveTistoryDraft({ ...base, dryRun: false, harness: { entryUrl: "https://harnessblog.tistory.com/manage/newpost/", setup } });
  ok("임시저장: draft_saved + 저장 요청 1회", r2.status === "draft_saved" && saveReq === 1, `${r2.status} / 요청 ${saveReq}`);
  ok("★ 발행 계열 버튼은 0회", lastState?.publish === 0, String(lastState?.publish));

  // ── 편집기를 못 찾으면 저장하지 않는다 ──
  const r3 = await saveTistoryDraft({ ...base, dryRun: false, harness: { entryUrl: "https://harnessblog.tistory.com/manage/newpost/?noTiny=1&x", setup: async (ctx) => {
    await setup(ctx);
    // 보조 경로(iframe)까지 막기 위해 iframe id 를 바꾼다
    await ctx.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { const f = document.getElementById("editor-tistory_ifr"); if (f) f.id = "other"; }));
  } } });
  ok("본문 편집기를 못 찾으면 failed, 저장 요청 0", r3.status === "failed" && saveReq === 0, r3.note);

  // ── 정적 검사: 티스토리 코드에 발행 버튼 셀렉터가 없다 ──
  const src = fs.readFileSync(path.join(process.cwd(), "lib", "tistory", "draft.ts"), "utf8") + fs.readFileSync(path.join(process.cwd(), "lib", "scrape", "selectors.ts"), "utf8").split("export const TISTORY")[1];
  const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  ok("★ 코드에 발행 버튼(publish-layer-btn·완료·공개발행) 클릭 경로 없음", !/publish-layer|text-is\('완료'\)|공개\s*발행'|has-text\('발행/.test(code));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `\n${fail}개 실패\n${logs.join("\n")}` : "\n전부 통과");
  process.exit(fail ? 1 : 0);
})();
