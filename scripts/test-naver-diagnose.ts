/** [네이버 화면 점검]을 연습판(scripts/harness)에 돌려 본다 — 실제 네이버 측정은 사용자 PC 에서 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nb-nd-"));
const HDIR = path.join(process.cwd(), "scripts", "harness");
(async () => {
  const { diagnoseNaver } = await import("@/lib/naver/diagnose");
  let posted = false;
  const r = await diagnoseNaver({
    harness: {
      entryUrl: "https://harness.test/outer.html",
      setup: async (ctx) => {
        await ctx.route("https://harness.test/**", (route) =>
          route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fs.readFileSync(path.join(HDIR, path.basename(new URL(route.request().url()).pathname))) }),
        );
        await ctx.route("https://blog.naver.com/**", (route) => {
          posted = true; // 최종 발행 버튼이 눌리면 여기로 간다
          return route.fulfill({ status: 200, body: "posted" });
        });
      },
    },
  });
  console.log(r.summary.join("\n"));
  const bad = r.summary.filter((l) => l.includes("✖")).length;
  console.log(`\n최종 발행 버튼 눌림: ${posted ? "예 ✖" : "아니오 ✔"}`);
  console.log(bad || posted ? `\n${bad + (posted ? 1 : 0)}개 실패` : "\n전부 통과");
  process.exit(bad || posted ? 1 : 0);
})();
