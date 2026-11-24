/** 티스토리 자동 재로그인(카카오 버튼 한 번) — 가짜 로그인 화면으로 확인. 비밀번호는 절대 넣지 않는다. */
import { chromium } from "playwright";
import { openTistoryWithRelogin } from "@/lib/tistory/session";
let fail = 0;
const ok = (n: string, c: boolean, e = "") => (console.log(`${c ? "✔" : "✖"} ${n}${e ? "  — " + e : ""}`), c || fail++);
const html = (b: string) => ({ status: 200, contentType: "text/html; charset=utf-8", body: `<!doctype html><meta charset=utf-8>${b}` });
(async () => {
  const exe = process.env.PW_CHROMIUM_PATH;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  for (const kakaoAlive of [true, false]) {
    const ctx = await b.newContext();
    await ctx.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      const cookie = route.request().headers()["cookie"] || "";
      if (u.host === "myblog.tistory.com") {
        if (!cookie.includes("TSSESSION=ok")) return route.fulfill(html(`<script>location.href="https://www.tistory.com/auth/login?redirectUrl=x"</script>`));
        return route.fulfill(html("<textarea id=post-title-inp></textarea>글쓰기"));
      }
      if (u.host === "www.tistory.com" && u.pathname === "/auth/login")
        return route.fulfill(html(`<a class="btn_login link_kakao_id" href="https://accounts.kakao.com/login?continue=https%3A%2F%2Fkauth.kakao.com%2Foauth%3Fredirect_uri%3Dhttps%3A%2F%2Fwww.tistory.com%2Fauth%2Fkakao">카카오계정으로 로그인</a>`));
      if (u.host === "accounts.kakao.com")
        return kakaoAlive
          ? route.fulfill(html(`<script>setTimeout(()=>location.href="https://www.tistory.com/auth/kakao?code=abc",300)</script>`))
          : route.fulfill(html(`<input name=id><input type=password name=pw><button>로그인</button>`));
      // 실제 흐름처럼: 티스토리 자기 콜백이 자기 쿠키를 심고 첫 화면으로 보낸다
      if (u.host === "www.tistory.com" && u.pathname === "/auth/kakao")
        return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "set-cookie": "TSSESSION=ok; Domain=.tistory.com; Path=/; Secure" }, body: `<script>setTimeout(()=>location.href="https://www.tistory.com/",300)</script>` });
      if (u.host === "www.tistory.com") return route.fulfill(html("티스토리 홈"));
      return route.fulfill(html(""));
    });
    const p = await ctx.newPage();
    const r = await openTistoryWithRelogin(p, "https://myblog.tistory.com/manage/newpost/");
    if (kakaoAlive) ok("카카오 로그인이 살아 있으면 버튼 한 번으로 자동 재로그인 → 글쓰기 화면", r.ok && r.relogged && p.url().startsWith("https://myblog.tistory.com/manage/newpost"), JSON.stringify(r));
    else {
      const typed = await p.locator("input[type=password]").inputValue().catch(() => "");
      ok("카카오도 비밀번호를 물으면 멈춤(need_password), 비밀번호 입력 안 함", !r.ok && r.reason === "need_password" && typed === "", JSON.stringify(r));
    }
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `\n${fail}개 실패` : "\n전부 통과");
  process.exit(fail ? 1 : 0);
})();
