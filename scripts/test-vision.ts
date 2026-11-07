/** 크롤링 사진 판정(워터마크 탈락·판정 실패 시 미채택)과 생성 사진 판정(글자 혼입) — claude 3회 호출 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-vis-"));
process.env.DATA_DIR = path.join(tmp, "data");
let fail = 0;
const ok = (n: string, c: boolean, e = "") => (console.log(`${c ? "✔" : "✖"} ${n}${e ? "  — " + e : ""}`), c || fail++);

(async () => {
  const { judgeCrawled, judgeGenerated, crawlRejectReason } = await import("@/lib/ai/vision");
  const { chromium } = await import("playwright");
  const exe = process.env.PW_CHROMIUM_PATH;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const pg = await b.newPage({ viewport: { width: 640, height: 420 } });
  const scene = `<div style="position:absolute;inset:0;background:linear-gradient(#9ad0f5,#e8f4fb 55%,#3b7d3b 55%)"></div>
    <div style="position:absolute;left:220px;top:150px;width:200px;height:120px;background:#8b5a2b;border-radius:8px"></div>`;
  await pg.setContent(`<body style="margin:0">${scene}
    <div style="position:absolute;inset:0;display:grid;place-items:center;font:bold 54px sans-serif;color:rgba(255,255,255,.55);transform:rotate(-20deg)">© shutterstock</div>
    <div style="position:absolute;right:10px;bottom:8px;font:16px sans-serif;color:#fff">stock-photo-123456</div></body>`);
  const wm = path.join(tmp, "wm.png");
  await pg.screenshot({ path: wm });
  await pg.setContent(`<body style="margin:0">${scene}<div style="position:absolute;left:60px;top:40px;font:bold 40px serif;color:#222">HUMIDETRICE Wmt13</div></body>`);
  const txt = path.join(tmp, "txt.png");
  await pg.screenshot({ path: txt });
  await b.close();

  const v1 = await judgeCrawled(wm, "들판 위 나무 상자", "캠핑 장비 이야기");
  ok("워터마크 사진은 탈락(fit 강제 false) + 사유 기록", v1.watermark && !v1.fit, crawlRejectReason(v1));
  const v2 = await judgeCrawled(path.join(tmp, "없는파일.png"), "q", "c");
  ok("판정이 실패한 사진은 채택하지 않는다", !v2.fit, v2.reason.slice(0, 80));
  const v3 = await judgeGenerated(txt, "들판 위 나무 상자");
  ok("생성 사진: 깨진 글자 혼입을 잡는다", v3.hasText && !v3.ok, v3.reason);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `\n${fail}개 실패` : "\n전부 통과");
  process.exit(fail ? 1 : 0);
})();
