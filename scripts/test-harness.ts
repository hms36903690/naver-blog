/**
 * 9장 6.5-a — 로컬 하네스로 입력 "순서"를 확정한다(네이버 계정 불필요).
 * ⚠️ 하네스는 순서를 검증하는 것이지 셀렉터를 검증하는 것이 아니다. 셀렉터는 로그인 후 6.5-b 에서 실측.
 * ⚠️ 하네스의 형광펜(execCommand hiliteColor)은 실제 에디터와 다르게 동작한다 — 서식 위치는 증거로 쓰지 말 것.
 * 실행: npx tsx scripts/test-harness.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserContext } from "playwright";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-harness-"));
process.env.DATA_DIR = tmp;
const HDIR = path.join(process.cwd(), "scripts", "harness");

let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✔" : "✖"} ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) fail++;
};

let lastPostUrl = "";
async function setup(ctx: BrowserContext) {
  await ctx.route("https://harness.test/**", async (route) => {
    const u = new URL(route.request().url());
    const f = path.join(HDIR, path.basename(u.pathname));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "nf" });
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fs.readFileSync(f) });
  });
  await ctx.route("https://blog.naver.com/**", (route) => {
    lastPostUrl = route.request().url();
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<h1>게시글</h1>" });
  });
}

async function main() {
  const { publishDraft } = await import("@/lib/naver/publish");
  const { chromium } = await import("playwright");
  const { codepoints } = await import("@/lib/text");

  // 테스트 사진 2장 만들기
  const exe = process.env.PW_CHROMIUM_PATH;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const pg = await b.newPage({ viewport: { width: 400, height: 300 } });
  const imgs: string[] = [];
  for (const [i, color] of ["#d9a066", "#6699cc"].entries()) {
    await pg.setContent(`<body style="margin:0;background:${color}"><h1 style="font-size:60px">${i + 1}</h1></body>`);
    const f = path.join(tmp, `사진${i + 1}.png`);
    await pg.screenshot({ path: f });
    imgs.push(f);
  }
  await b.close();

  const draft = {
    title: "하네스 테스트 제목",
    sections: [
      { type: "heading" as const, text: "첫 번째 소제목" },
      { type: "paragraph" as const, text: "앞부분 문장입니다. 핵심 구절이 여기 있고 뒷부분이 이어집니다.", highlight: "핵심 구절" },
      { type: "quote" as const, text: "짧은 인용구 한 줄" },
      { type: "paragraph" as const, text: "인용구 다음 문단은 인용구 밖에 있어야 합니다." },
      { type: "divider" as const },
      { type: "paragraph" as const, text: "구분선 다음 문단 **굵게** ~~취소~~ 물결~ ⚠️ 주의 ❤️ 1️⃣" },
      { type: "image" as const, query: "q1", caption: "첫 사진 설명" },
      { type: "paragraph" as const, text: "사진 다음 문단은 캡션에 붙지 않아야 합니다." },
      { type: "image" as const, query: "q2", caption: "둘째 사진" },
      ...Array.from({ length: 14 }, (_, i) => ({ type: "paragraph" as const, text: `긴 글 채우기 문단 ${i + 1} — 스크롤과 하단 검색바 회피를 시험합니다.` })),
      { type: "quote" as const, text: "마지막 인용구" },
      { type: "paragraph" as const, text: "끝 문단." },
    ],
  };
  const images = new Map<number, string>([
    [6, imgs[0]],
    [8, imgs[1]],
  ]);
  const logs: string[] = [];
  const base = {
    jobId: 1,
    draft,
    images,
    headless: true,
    visibility: "private" as const,
    log: (m: string) => logs.push(m),
  };

  // ── ① 연습 모드: 전체 입력 ──
  let dump: any = null;
  const { publishDraft: _p } = { publishDraft };
  const t0 = Date.now();
  const r1 = await publishDraft({
    ...base,
    dryRun: true,
    harness: {
      entryUrl: "https://harness.test/outer.html",
      setup: async (ctx) => {
        await setup(ctx);
        // 브라우저가 닫히기 직전 상태를 읽기 위해 스크린샷 시점에 덤프
        ctx.on("page", (page) => {
          const orig = page.screenshot.bind(page);
          (page as any).screenshot = async (o: any) => {
            const f = page.frames().find((fr) => fr.name() === "mainFrame");
            if (f && !dump) dump = await f.evaluate(() => (window as any).__dump());
            return orig(o);
          };
        });
      },
    },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok("연습 모드 결과 dry_run", r1.status === "dry_run", `${r1.note} (${secs}초)`);
  ok("빠르다(boundingBox 30초 대기 없음, 7-27)", Number(secs) < 120, `${secs}초`);
  if (!dump) {
    console.log("덤프 실패", logs);
    process.exit(1);
  }
  const comps = dump.components as Array<{ cls: string; text: string; caption: null | { cls: string; text: string } }>;
  console.log(comps.map((c, i) => `   ${i}. [${c.cls}] ${c.text.slice(0, 50)}${c.caption ? ` {캡션:${c.caption.text}|${c.caption.cls.includes("se-is-empty") ? "비어있음" : "OK"}}` : ""}`).join("\n"));
  ok("취소선 버튼 0회 (7-1)", dump.strike === 0, String(dump.strike));
  ok("복원 팝업·차단막 제거됨 (7-3)", !dump.dim && !dump.popup);
  ok("하단 글감 검색바로 샌 입력 없음 (7-6)", dump.bottomTyped === "", JSON.stringify(dump.bottomTyped));
  ok("우측 도크·도움말 닫힘(스크린샷 전, 7-21)", !dump.sidebar && !dump.help);
  ok("제목 칸에는 제목만 (7-26)", dump.title === "하네스 테스트 제목", dump.title);
  const quotes = comps.filter((c) => c.cls.includes("se-quotation"));
  ok("인용구 2개, 각각 그 문장만 담김 (7-5)", quotes.length === 2 && quotes[0].text === "짧은 인용구 한 줄" && quotes[1].text === "마지막 인용구", JSON.stringify(quotes.map((q) => q.text)));
  const qi = comps.findIndex((c) => c.cls.includes("se-quotation"));
  ok("인용구 다음 문단은 인용구 밖, 바로 다음 블록", comps[qi + 1]?.text.startsWith("인용구 다음 문단"), comps[qi + 1]?.text);
  const di = comps.findIndex((c) => c.cls.includes("se-horizontalLine"));
  ok("구분선 다음 문단이 구분선 뒤에 온다", di > 0 && comps[di + 1]?.text.startsWith("구분선 다음 문단"), comps[di + 1]?.text);
  const all = comps.map((c) => c.text).join("\n");
  ok("마크다운 무력화 (7-8)", !/\*\*|~~|~/.test(all) && all.includes("굵게") && all.includes("물결～"));
  const emo = comps.find((c) => c.text.includes("주의"))!.text;
  ok("VS16 이모지 중복 없음 (7-25)", emo.includes("⚠️ 주의") && !emo.includes("⚠⚠") && emo.includes("❤️") && emo.includes("1️⃣"), codepoints(emo.slice(emo.indexOf("⚠") - 1, emo.indexOf("⚠") + 3)));
  const imgComps = comps.filter((c) => c.cls.includes("se-image"));
  ok("사진 2장 업로드됨 — 파일 선택창 처리 (7-7)", imgComps.length === 2);
  ok("캡션이 사진 설명 칸에 들어감, se-is-empty 없음 (7-18)", imgComps[0]?.caption?.text === "첫 사진 설명" && !imgComps[0]?.caption?.cls.includes("se-is-empty") && imgComps[1]?.caption?.text === "둘째 사진");
  const ii = comps.findIndex((c) => c.cls.includes("se-image"));
  ok("사진 다음 문단이 캡션과 합쳐지지 않음", comps[ii + 1]?.text.startsWith("사진 다음 문단"), comps[ii + 1]?.text);
  ok("소제목 서식 적용", /se-style-sectionTitle/.test(JSON.stringify(dump)));
  ok("형광펜·굵게 켜고 끄기 1쌍", dump.hlOn === 1 && dump.hlOff === 1 && dump.bold === 2, JSON.stringify({ on: dump.hlOn, off: dump.hlOff, bold: dump.bold }));
  ok("끝 문단까지 입력", comps[comps.length - 1].text.replace(/⏎/g, "") === "끝 문단.", comps[comps.length - 1].text);
  // 스크린샷이 글 전체를 담았는지(뷰포트 900 보다 훨씬 김)
  const shot = r1.screenshot!;
  const { chromium: c2 } = await import("playwright");
  const bb = await c2.launch(exe ? { executablePath: exe } : {});
  const p2 = await bb.newPage();
  await p2.goto("file://" + shot);
  const h = await p2.evaluate(() => (document.querySelector("img") as HTMLImageElement).naturalHeight);
  await bb.close();
  ok("스크린샷이 한 화면(900)보다 길다 — 글 전체 (7-20)", h > 1300, `높이 ${h}px`);

  // ── ② 취소 버튼에 클래스가 없을 때도 '취소선'을 누르지 않는다 ──
  const r2 = await publishDraft({
    ...base,
    draft: { title: "t2", sections: [{ type: "paragraph", text: "짧은 글입니다." }, { type: "paragraph", text: "둘" }, { type: "paragraph", text: "셋" }] },
    images: new Map(),
    dryRun: false,
    harness: { entryUrl: "https://harness.test/outer.html?noCancelClass=1", setup },
  });
  ok("실발행(하네스): 비공개 선택 확인 후 게시글 주소 (7-11, 7-19)", r2.status === "published" && /vis=open_private/.test(lastPostUrl), `${r2.status} ${lastPostUrl || r2.note}`);

  // ── ③ 발행 버튼이 iframe 안에 있는 환경 ──
  const r3 = await publishDraft({
    ...base,
    draft: { title: "t3", sections: [{ type: "paragraph", text: "하나" }, { type: "paragraph", text: "둘" }, { type: "paragraph", text: "셋" }] },
    images: new Map(),
    dryRun: false,
    visibility: "neighbor",
    harness: { entryUrl: "https://harness.test/outer.html?publishInside=1", setup },
  });
  ok("발행 버튼이 iframe 안이어도 찾는다 + 이웃공개", r3.status === "published" && /vis=open_neighbor/.test(lastPostUrl), `${r3.status} ${lastPostUrl || r3.note}`);

  // ── ③-2 네이버 임시저장까지만: 저장 버튼만 누르고 발행 레이어는 열지 않는다 ──
  let saveReq = 0;
  let state3: any = null;
  lastPostUrl = "";
  const r3b = await publishDraft({
    ...base,
    draft: { title: "임시저장 시험", sections: [{ type: "paragraph", text: "하나" }, { type: "paragraph", text: "둘" }, { type: "paragraph", text: "셋" }] },
    images: new Map(),
    dryRun: false,
    draftOnly: true,
    harness: {
      entryUrl: "https://harness.test/outer.html",
      setup: async (ctx) => {
        await setup(ctx);
        await ctx.route("https://harness.test/save", (route) => {
          saveReq++;
          return route.fulfill({ status: 200, body: "{}" });
        });
        ctx.on("page", (pg) => {
          const orig = pg.close.bind(pg);
          void orig;
          pg.on("response", async () => {
            state3 = await pg.evaluate(() => ({ save: (window as any).__saveClicks, pub: (window as any).__publishOpened })).catch(() => state3);
          });
        });
      },
    },
  });
  ok("임시저장 모드: draft_saved, 저장 요청 1회", r3b.status === "draft_saved" && saveReq === 1, `${r3b.status} / 저장 ${saveReq}`);
  ok("★ 임시저장 모드: 발행 레이어 0회·게시글 주소 없음", (state3?.pub ?? 0) === 0 && !lastPostUrl && !r3b.url, JSON.stringify(state3));

  // ── ④ 공개 범위 라디오가 없으면 발행하지 않는다 ──
  const r4 = await publishDraft({
    ...base,
    draft: { title: "t4", sections: [{ type: "paragraph", text: "하나" }, { type: "paragraph", text: "둘" }, { type: "paragraph", text: "셋" }] },
    images: new Map(),
    dryRun: false,
    harness: { entryUrl: "https://harness.test/outer.html?noVisibility=1", setup },
  });
  ok("공개 범위 확인 불가 → 발행 안 하고 failed", r4.status === "failed" && !r4.url && /공개 범위/.test(r4.note), r4.note);

  // ── ⑤ 본문을 못 찾으면 제목 칸으로 새지 않고 실패 ──
  let dump5: any = null;
  const r5 = await publishDraft({
    ...base,
    dryRun: true,
    harness: {
      entryUrl: "https://harness.test/outer.html?noBody=1",
      setup: async (ctx) => {
        await setup(ctx);
        ctx.on("page", (page) => {
          const orig = page.screenshot.bind(page);
          (page as any).screenshot = async (o: any) => {
            const f = page.frames().find((fr) => fr.name() === "mainFrame");
            if (f) dump5 = await f.evaluate(() => (window as any).__dump());
            return orig(o);
          };
        });
      },
    },
  });
  ok("본문 없음 → failed + 스크린샷 (7-26)", r5.status === "failed" && Boolean(r5.screenshot), r5.note);
  ok("제목 칸에 본문이 들어가지 않았다", dump5?.title === "하네스 테스트 제목", JSON.stringify(dump5?.title));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `\n${fail}개 실패` : "\n전부 통과");
  console.log("--- 기록 ---\n" + logs.join("\n"));
  process.exit(fail ? 1 : 0);
}
main();
