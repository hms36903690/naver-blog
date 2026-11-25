/**
 * 10장 A — 계정 없이 확인 가능한 것(계산·안전장치·수집 필터·텍스트 처리·최소 재현).
 * 실행: npm test   (임시 data 폴더를 써서 실제 DB 를 건드리지 않는다)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-test-"));
process.env.DATA_DIR = tmp;
process.env.TZ = process.env.TZ || "Asia/Seoul";

let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✔" : "✖"} ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) fail++;
};

async function main() {
  const { neuronsPerImage, imagesPerDay } = await import("@/lib/ai/neurons");
  const { getDb, countPublishedToday } = await import("@/lib/db");
  const { getSettings, updateSettings, resetSettings, UnknownSettingError } = await import("@/lib/settings");
  const { checkPublishGuard } = await import("@/lib/naver/publish");
  const { isInsideData, dataRoot } = await import("@/lib/paths");
  const { filterAnchors } = await import("@/lib/scrape/trends");
  const { sanitizeDraft } = await import("@/lib/ai/content");
  const { neutralizeMarkdown, markdownLeaks } = await import("@/lib/text");
  const { draftSchemaFor } = await import("@/lib/types");

  // ── 7-12 뉴런 공식 ──
  const table = [2, 4, 6, 8].map((s) => [Math.round(neuronsPerImage(s)), imagesPerDay(s)]);
  ok("뉴런 표 96/173/250/326, 104/57/40/30장", JSON.stringify(table) === JSON.stringify([[96, 104], [173, 57], [250, 40], [326, 30]]), JSON.stringify(table));
  ok("6스텝 = 249.6 (정수 아님)", Math.abs(neuronsPerImage(6) - 249.6) < 1e-9, String(neuronsPerImage(6)));

  // ── 설정 기본값·클램프·리셋 ──
  const d = getSettings();
  ok("기본값: 연습 모드 켜짐, 공개 범위 비공개, 하루 3편, 30분", d.dryRun && d.visibility === "private" && d.dailyPublishLimit === 3 && d.minPublishIntervalMin === 30);
  const c = updateSettings({ dailyPublishLimit: 999, claudeConcurrency: 0, cfImageSteps: 20, minPublishIntervalMin: -5 });
  ok("범위 클램프 (999→50, 0→1, 20→8, -5→0)", c.dailyPublishLimit === 50 && c.claudeConcurrency === 1 && c.cfImageSteps === 8 && c.minPublishIntervalMin === 0);
  let threw = false;
  try {
    updateSettings({ hackMe: 1 });
  } catch (e) {
    threw = e instanceof UnknownSettingError;
  }
  ok("알 수 없는 키는 거절", threw);
  threw = false;
  try {
    updateSettings({ visibility: "everyone" });
  } catch (e) {
    threw = e instanceof UnknownSettingError;
  }
  ok("알 수 없는 공개 범위는 거절", threw);
  ok("리셋하면 기본값", JSON.stringify(resetSettings()) === JSON.stringify(d));

  // ── 7-22 하루 집계는 로컬 날짜 ──
  const db = getDb();
  // 오늘 로컬 02:00 = UTC 로는 어제 17:00 (KST 기준)
  const local2am = new Date();
  local2am.setHours(2, 0, 0, 0);
  const utcStr = local2am.toISOString().replace("T", " ").slice(0, 19);
  db.prepare("INSERT INTO posts (job_id, status, published_at) VALUES (1, 'published', ?)").run(utcStr);
  const naive = (db.prepare("SELECT COUNT(*) n FROM posts WHERE status='published' AND date(published_at) = date('now','localtime')").get() as { n: number }).n;
  ok(`새벽 발행(UTC ${utcStr})이 오늘로 집계된다`, countPublishedToday() === 1, `로컬 기준 ${countPublishedToday()}편 / 틀린 쿼리 ${naive}편`);

  // ── 발행 가드 3종 ──
  const base = getSettings();
  ok("가드: 전체 중단 → blocked", checkPublishGuard({ ...base, killSwitch: true }).blocked);
  ok("가드: 한도(1편) 도달 → blocked", checkPublishGuard({ ...base, dailyPublishLimit: 1, minPublishIntervalMin: 0 }).blocked);
  // 방금 발행한 기록 → 30분 간격 위반
  db.prepare("DELETE FROM posts").run();
  db.prepare("INSERT INTO posts (job_id, status, published_at) VALUES (1, 'published', datetime('now','-5 minutes'))").run();
  const g = checkPublishGuard({ ...base, dailyPublishLimit: 10, minPublishIntervalMin: 30 });
  ok("가드: 간격(5분<30분) → blocked", g.blocked, g.blocked ? g.reason : "");
  ok("가드: 조건 다 통과하면 허용", !checkPublishGuard({ ...base, dailyPublishLimit: 10, minPublishIntervalMin: 3 }).blocked);
  db.prepare("DELETE FROM posts").run();

  // ── 티스토리 주 3회: 이번 주(월~일, 로컬)만 센다 ──
  const { countTistoryDraftsThisWeek } = await import("@/lib/db");
  db.prepare("DELETE FROM posts").run();
  const monday = db.prepare("SELECT date('now','localtime','weekday 0','-6 days') d").get() as { d: string };
  const ins = db.prepare("INSERT INTO posts (job_id, status, created_at) VALUES (1, ?, datetime(?, 'utc'))");
  ins.run("draft_saved", `${monday.d} 01:30:00`); // 월요일 새벽(로컬) — UTC 로는 전날
  ins.run("draft_unverified", `${monday.d} 12:00:00`);
  const lastSunday = (db.prepare("SELECT date(?, '-1 day') d").get(monday.d) as { d: string }).d;
  ins.run("draft_saved", `${lastSunday} 22:00:00`); // 지난주 일요일
  ins.run("dry_run", `${monday.d} 13:00:00`); // 연습은 안 셈
  ok("이번 주 티스토리 임시저장 수 = 2 (월요일 새벽 포함, 지난주·연습 제외)", countTistoryDraftsThisWeek() === 2, `월요일 ${monday.d}, 셈 ${countTistoryDraftsThisWeek()}`);
  ok("주간 기본값 3편", getSettings().tistoryWeeklyLimit === 3);
  db.prepare("DELETE FROM posts").run();

  // ── 경로 탈출 방지 + NFC (7-23) ──
  ok("data 안 파일 허용", isInsideData(path.join(dataRoot, "images", "a.png")));
  ok("/etc/passwd 거절", !isInsideData("/etc/passwd"));
  ok("../ 탈출 거절", !isInsideData(path.join(dataRoot, "..", "x.png")));
  ok("data 폴더 자체 이름 접두사 속임 거절", !isInsideData(dataRoot + "-evil/a.png"));
  const nfd = path.join(dataRoot, "사진", "카페.png").normalize("NFD");
  ok("NFD 로 들어온 한글 경로도 data 안으로 인정", isInsideData(nfd));

  // ── 6-4 수집 필터 ──
  const raw = [
    { href: "https://n.news.naver.com/mnews/article/001/0001", text: "홈카페 열풍, 원두 판매 30% 증가", ctx: "홈카페 열풍, 원두 판매 30% 증가 집에서 커피를 내리는 사람이 늘면서…" },
    { href: "https://n.news.naver.com/mnews/article/001/0001", text: "집에서 커피를 내리는 사람이 늘면서 원두 판매가 크게 늘었다는 분석이 나왔다", ctx: "…" },
    { href: "https://n.news.naver.com/mnews/article/002/0002", text: "네이버뉴스새 창 열림", ctx: "" },
    { href: "https://help.naver.com/alias/news/news_21.naver", text: "뉴스 기사와 댓글로 인한 문제 발생시 24시간 센터로 접수해주세요", ctx: "" },
    { href: "https://news.naver.com/main/ads", text: "광고 홈카페 머신 특가 세일 진행중", ctx: "" },
    { href: "https://blog.naver.com/coffeelover/223456789012", text: "홈카페 입문 3개월 솔직 후기", ctx: "홈카페 입문 3개월 솔직 후기 그라인더부터…" },
    { href: "https://blog.naver.com/coffeelover", text: "커피러버의 블로그 홈 바로가기 링크", ctx: "" },
  ];
  const news = filterAnchors(raw, "news", 8);
  const blog = filterAnchors(raw, "blog", 8);
  ok("뉴스: 같은 URL 은 하나(짧은 제목), '새 창 열림'·고객센터·광고 제외", news.length === 1 && news[0].title === "홈카페 열풍, 원두 판매 30% 증가", JSON.stringify(news.map((n) => n.title)));
  ok("블로그: 게시글만, 블로그 홈 제외", blog.length === 1 && blog[0].url.endsWith("/223456789012"));

  // ── 유료 스톡 사진은 AI 판정 전에 거른다 ──
  const { isStockUrl } = await import("@/lib/scrape/images");
  ok("스톡 주소 거름(네이버 썸네일 안에 인코딩된 Getty 포함)", isStockUrl("https://search.pstatic.net/common/?src=https%3A%2F%2Fmedia.gettyimages.com%2Fphotos%2Fx.jpg&type=a340") && isStockUrl("https://www.istockphoto.com/a.jpg"));
  ok("일반 블로그 사진은 통과", !isStockUrl("https://blogfiles.pstatic.net/2026/a.jpg") && !isStockUrl("https://search.pstatic.net/common/?src=https%3A%2F%2Fpostfiles.pstatic.net%2Fx.jpg"));

  // ── 7-24 highlight 정리 ──
  const draft = {
    title: "t",
    sections: [
      { type: "paragraph" as const, text: "옆 사이트는 한 시간째 폴대와 씨름 중이더라고요. 그때 확신했습니다.", highlight: "예쁜 것보다 빨리 펴지는 게 훨씬 중요합니다" },
      { type: "paragraph" as const, text: "가볍고 빨리 펴지는 텐트가 최고예요.", highlight: "빨리 펴지는 텐트" },
      { type: "divider" as const },
    ],
  };
  const san = sanitizeDraft(draft);
  ok("본문에 없는 highlight 만 떨어뜨림(1개)", san.droppedHighlights === 1 && !(san.draft.sections[0] as { highlight?: string | null }).highlight && (san.draft.sections[1] as { highlight?: string | null }).highlight === "빨리 펴지는 텐트");

  // ── 사진 소스별 스키마 ──
  const mk = (n: number) => ({ title: "제목", sections: [{ type: "paragraph", text: "a" }, { type: "paragraph", text: "b" }, { type: "paragraph", text: "c" }, ...Array.from({ length: n }, () => ({ type: "image", query: "q" }))] });
  ok("네이버 crawl: 이미지 6개 이상", !draftSchemaFor("crawl").safeParse(mk(5)).success && draftSchemaFor("crawl").safeParse(mk(6)).success);
  ok("local: 정확히 사진 장수", draftSchemaFor("local", 4).safeParse(mk(4)).success && !draftSchemaFor("local", 4).safeParse(mk(6)).success);
  ok("none: 이미지 0개", draftSchemaFor("none").safeParse(mk(0)).success && !draftSchemaFor("none").safeParse(mk(1)).success);

  // ── 티스토리 기준: 본문 1,500~2,000자(검증 1,300~2,300), 사진 2~4장 ──
  const { bodyChars } = await import("@/lib/types");
  const mkT = (chars: number, imgs: number) => ({
    title: "제목",
    sections: [
      ...Array.from({ length: 10 }, () => ({ type: "paragraph", text: "가".repeat(Math.round(chars / 10)) })),
      ...Array.from({ length: imgs }, () => ({ type: "image", query: "q" })),
    ],
  });
  ok("티스토리 검색사진: 1,700자·사진 3장 통과", draftSchemaFor("crawl", 0, "tistory").safeParse(mkT(1700, 3)).success);
  ok("티스토리 검색사진: 6장은 반려(2~4장)", !draftSchemaFor("crawl", 0, "tistory").safeParse(mkT(1700, 6)).success);
  ok("티스토리: 3,000자는 반려", !draftSchemaFor("ai", 0, "tistory").safeParse(mkT(3000, 2)).success);
  ok("AI 그림: 네이버·티스토리 모두 1~3장", draftSchemaFor("ai", 0, "tistory").safeParse(mkT(1700, 3)).success && draftSchemaFor("ai").safeParse(mkT(3000, 1)).success && !draftSchemaFor("ai").safeParse(mkT(3000, 4)).success && !draftSchemaFor("ai", 0, "tistory").safeParse(mkT(1700, 0)).success);
  ok("티스토리: 사진 없음이면 0장 + 분량 검사", draftSchemaFor("none", 0, "tistory").safeParse(mkT(1600, 0)).success && !draftSchemaFor("none", 0, "tistory").safeParse(mkT(900, 0)).success);
  ok("네이버 검색사진은 기존대로(6장 이상, 분량 제한 없음)", draftSchemaFor("crawl").safeParse(mkT(3000, 6)).success);
  ok("본문 글자 수 계산", bodyChars(mkT(1700, 3) as never) === 1700);

  // ── 네이버 인바운드: 글 끝 상담 신청 안내 ──
  const { appendNaverCta } = await import("@/lib/cta");
  const base3 = { title: "t", sections: [{ type: "paragraph" as const, text: "본문" }, { type: "paragraph" as const, text: "둘" }, { type: "paragraph" as const, text: "셋" }] };
  const withCta = appendNaverCta(base3, "안내 문구", "https://form.naver.com/response/abc");
  ok("신청서 주소가 있으면 끝에 [구분선·안내·주소] 3블록", withCta.sections.length === 6 && withCta.sections[3].type === "divider" && (withCta.sections[5] as { text: string }).text.includes("https://form.naver.com/response/abc"));
  ok("주소가 없으면 아무것도 안 붙임", appendNaverCta(base3, "안내", "").sections.length === 3);
  let badUrl = false;
  try {
    updateSettings({ naverCtaUrl: "form.naver.com/abc" });
  } catch (e) {
    badUrl = e instanceof UnknownSettingError;
  }
  ok("신청서 주소는 https:// 만 허용", badUrl && updateSettings({ naverCtaUrl: "https://form.naver.com/response/x" }).naverCtaUrl === "https://form.naver.com/response/x");
  ok("기본 안내 문구는 '전문가 연결' 형태(세무사법)", /세무사·노무사와 연결/.test(getSettings().naverCtaText));
  resetSettings();

  // ── AI 가 쓴 카테고리 이름을 블로그 카테고리로 맞추기 ──
  const { categoryFromLabel } = await import("@/lib/types");
  ok("카테고리 이름 맞추기(네이버)", categoryFromLabel("임금 노무", "naver") === "wage" && categoryFromLabel("증여/상속", "naver") === "inherit" && categoryFromLabel("세금", "naver") === "tax");
  ok("카테고리 이름 맞추기(티스토리)", categoryFromLabel("금융 재테크", "tistory") === "money" && categoryFromLabel("보험·건강", "tistory") === "health");
  ok("다른 블로그 카테고리·엉뚱한 이름은 무시", categoryFromLabel("세금", "tistory") === undefined && categoryFromLabel("여행", "naver") === undefined);

  // ── 태그 정리 ──
  const { cleanTags } = await import("@/lib/types");
  ok("태그 정리: # 떼기·띄어쓰기 제거·중복 제거·최대 10개", JSON.stringify(cleanTags(["#종합 소득세", "종합소득세", "##절세", "", ...Array.from({ length: 12 }, (_, i) => "t" + i)])) === JSON.stringify(["종합소득세", "절세", "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]));

  // ── 발행 실패 조치 안내 ──
  const { diagnoseFailure } = await import("@/lib/failure");
  const dg = (t: string, target: "naver" | "tistory" = "naver", hasDraft = true) => diagnoseFailure(t, { target, hasDraft });
  ok("조치: 네이버 로그인 풀림 → [네이버 로그인]+[다시 시도]", JSON.stringify(dg("글쓰기 로그인이 풀렸습니다. [네이버 로그인]을 다시…").actions) === JSON.stringify(["naverLogin", "retry"]));
  ok("조치: 티스토리 로그인 → [티스토리 로그인]", dg("티스토리 로그인이 풀렸습니다.", "tistory").actions[0] === "tistoryLogin");
  ok("조치: 게시글 주소 미확인 → 먼저 블로그 확인(중복 발행 방지)", dg("발행 버튼을 눌렀지만 게시글 주소로 바뀌지 않았습니다.").actions[0] === "naverBlog");
  ok("조치: 공개 범위 → 안전 정지 안내", /공개 범위/.test(dg("공개 범위를 확인할 수 없어 발행하지 않고 중단했습니다.").title));
  ok("조치: 글이 없으면 [처음부터 다시 만들기]", dg("본문 쓰기 실패: …", "naver", false).actions.includes("remake") && !dg("알 수 없는 오류", "naver", false).actions.includes("retry"));
  ok("조치: 하루 한도 → 설정+다시 시도", JSON.stringify(dg("오늘 발행 한도(3편)에 도달했습니다.").actions) === JSON.stringify(["settings", "retry"]));

  // ── 로그인 정보 갱신 저장 + 유지 기간 읽기 ──
  const { refreshSessionFile, summarizeSessionFile } = await import("@/lib/sessionFile");
  {
    const { chromium } = await import("playwright");
    const exe2 = process.env.PW_CHROMIUM_PATH;
    const br = await chromium.launch(exe2 ? { executablePath: exe2 } : {});
    const ctx = await br.newContext();
    const sf = path.join(tmp, "ts-session.json");
    const in30 = Math.floor(Date.now() / 1000) + 30 * 86400;
    await ctx.addCookies([{ name: "TSSESSION", value: "x", domain: ".tistory.com", path: "/", expires: in30 }]);
    await refreshSessionFile(ctx, sf);
    const sum = summarizeSessionFile(sf, /tistory\.com$/, ["TSSESSION"]);
    ok("로그인 정보 갱신 저장 + 유지 기간(30일 뒤) 읽기", sum.exists && !sum.sessionOnly && Math.abs(new Date(sum.until!).getTime() / 1000 - in30) < 2, JSON.stringify(sum));
    const ctx2 = await br.newContext();
    await ctx2.addCookies([{ name: "TSSESSION", value: "x", domain: ".tistory.com", path: "/" }]);
    await refreshSessionFile(ctx2, sf);
    ok("'로그인 상태 유지' 꺼짐(세션 쿠키만) 감지", summarizeSessionFile(sf, /tistory\.com$/, ["TSSESSION"]).sessionOnly);
    await br.close();
  }

  // ── 보험 광고 안전장치: 문제 표현 검사(사회보험·공공기관은 통과) ──
  const { scanCompliance, appendComplianceNotice } = await import("@/lib/compliance");
  const mkC = (t: string) => ({ title: "제목", sections: [{ type: "paragraph" as const, text: t }, { type: "paragraph" as const, text: "둘" }, { type: "paragraph" as const, text: "셋" }] });
  const clean = scanCompliance(mkC("국민건강보험공단 안내에 따르면 4대보험과 고용보험, 산재보험, 국민연금 보험료는 매달 신고합니다. 건강보험 자격도 확인하세요."));
  ok("사회보험·공공기관 표현은 걸리지 않음", clean.length === 0, JSON.stringify(clean));
  const dirty = scanCompliance(mkC("법인 대표라면 종신보험이나 CEO플랜보다 경영인 정기보험 가입하세요. 삼성생명 상품이 보장 내용이 좋습니다."));
  ok("보험 상품명·가입 권유·보험사·보장 표현은 걸림", ["종신보험", "CEO플랜", "가입하세요", "삼성생명"].every((w) => dirty.some((h) => h.word.includes(w))) && dirty.some((h) => h.kind === "보장 내용"), dirty.map((h) => h.word).join(","));
  ok("심의필 문구는 여러 줄을 글 끝에 붙임", appendComplianceNotice(mkC("x"), "심의필 제1호\n유의사항").sections.length === 5);
  ok("보험 광고 안전장치는 기본 켜짐", getSettings().complianceMode === true && getSettings().complianceNotice === "");

  // ── 7-8 마크다운 무력화 ──
  const md = "정말 좋았어요~~ **진짜** `코드`\n# 제목\n> 인용\n- 목록\n물결~ 하나";
  const neu = neutralizeMarkdown(md);
  ok("마크다운 무력화 후 누출 0", markdownLeaks(neu).length === 0 && !neu.includes("~"), JSON.stringify(neu));

  // ── 7-1 / 7-2 최소 재현 (로컬 HTML) ──
  const { chromium } = await import("playwright");
  const exe = process.env.PW_CHROMIUM_PATH;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage();
  await page.setContent(`
    <div class="toolbar"><button>취소선</button><button>예약 발행 0건</button><button data-click-area="tpb.publish">발행</button></div>
    <div class="se-popup-container"><button>취소</button><button>확인</button></div>`);
  const oldCancel = await page.locator("button:has-text('취소')").count();
  const newCancel = await page.locator(".se-popup-container button:text-is('취소')").count();
  ok("7-1: :has-text('취소') 2개 vs 팝업 스코프 :text-is 1개", oldCancel === 2 && newCancel === 1, `${oldCancel} vs ${newCancel}`);
  const oldPub = await page.locator("button:has-text('발행')").count();
  const newPub = await page.locator("button[data-click-area='tpb.publish']").count();
  ok("7-2: :has-text('발행') 2개 vs 데이터 속성 1개", oldPub === 2 && newPub === 1, `${oldPub} vs ${newPub}`);
  await browser.close();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `\n${fail}개 실패` : "\n전부 통과");
  process.exit(fail ? 1 : 0);
}
main();
