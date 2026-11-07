/**
 * 10장 A — AI 호출 실검증(claude 구독 사용량을 씁니다. 약 6~8회 호출, 3~6분).
 * 네이버 수집 대신 고정 자료로 글감·본문을 만들고, 사진 판독(@경로, 프로젝트 밖)과 내 사진 설명 1회 생성을 확인한다.
 * 실행: npx tsx scripts/test-ai.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nb-ai-"));
process.env.DATA_DIR = path.join(tmp, "data");
let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✔" : "✖"} ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) fail++;
};

async function main() {
  const { runClaude, claudeCallCount } = await import("@/lib/claude");
  const { generateIdeas, generateDraft, sanitizeDraft } = await import("@/lib/ai/content");
  const { markdownLeaks } = await import("@/lib/text");
  const { describePhotos, listLocalPhotos, placePhotos } = await import("@/lib/localPhotos");
  const { modePrompt, photoHintFor } = await import("@/lib/ai/templates");
  const { runClaudeJson } = await import("@/lib/claude");
  const { draftSchemaFor } = await import("@/lib/types");
  const { chromium } = await import("playwright");

  // 사진 2장(프로젝트 밖, 한글 폴더) 만들기
  const photoDir = path.join(tmp, "내 사진");
  fs.mkdirSync(photoDir);
  const exe = process.env.PW_CHROMIUM_PATH;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const pg = await b.newPage({ viewport: { width: 500, height: 400 } });
  await pg.setContent(`<body style="margin:0;background:#f4efe6;display:grid;place-items:center;height:100vh">
    <div style="width:220px;height:160px;background:#6b3e26;border-radius:0 0 90px 90px;position:relative">
    <div style="position:absolute;top:10px;left:20px;right:20px;height:40px;background:#c08552;border-radius:50%"></div></div></body>`);
  await pg.screenshot({ path: path.join(photoDir, "사진2.png") });
  await pg.setContent(`<body style="margin:0;background:#87ceeb"><div style="position:absolute;bottom:0;width:100%;height:45%;background:#2e8b57"></div>
    <div style="position:absolute;top:60px;right:80px;width:90px;height:90px;border-radius:50%;background:#ffd700"></div></body>`);
  await pg.screenshot({ path: path.join(photoDir, "사진10.png") });
  await pg.setContent(`<body style="margin:0;background:#fff"><div style="margin:100px;width:120px;height:120px;background:#d22"></div></body>`);
  await pg.screenshot({ path: path.join(photoDir, "사진1.png") });
  await b.close();

  // ① 비전: 프로젝트 밖 절대경로 @첨부
  const red = path.join(photoDir, "사진1.png");
  const v = await runClaude("첨부한 이미지에 보이는 도형의 색과 모양을 한 문장으로 말하라.", { images: [red] });
  ok("비전(@경로, 프로젝트 밖·한글 폴더)으로 사진 내용을 읽는다", v.ok && /빨|red/i.test(v.ok ? v.text : ""), v.ok ? v.text.slice(0, 80) : v.error);

  // ② 자동 발굴: 글감 → 본문
  const sources = [
    { type: "news" as const, title: "홈카페 열풍, 원두 판매 30% 증가", summary: "집에서 커피를 내리는 사람이 늘면서 원두와 그라인더 판매가 크게 늘었다.", url: "https://n.news.naver.com/a/1" },
    { type: "news" as const, title: "고물가에 카페 대신 홈카페… 커피머신 수요 늘어", summary: "외식 물가 상승으로 커피값을 아끼려는 소비자가 홈카페 장비를 찾고 있다.", url: "https://n.news.naver.com/a/2" },
    { type: "blog" as const, title: "홈카페 입문 3개월 솔직 후기", summary: "핸드드립부터 시작해 그라인더를 바꾸고 나서 맛이 확 달라졌다는 경험담.", url: "https://blog.naver.com/x/223456789012" },
  ];
  const t0 = Date.now();
  const ideas = await generateIdeas("홈카페", sources, 5);
  ok("글감 5개 생성", ideas.ok && ideas.data.length >= 3, ideas.ok ? ideas.data.map((i) => i.title).join(" | ").slice(0, 140) : ideas.error);
  if (!ideas.ok) process.exit(1);
  const d = await generateDraft("홈카페", ideas.data[0], sources, "crawl", (w) => console.log("  재시도:", w.slice(0, 100)));
  ok("본문 생성(이미지 자리 6개 이상)", d.ok && d.data.sections.filter((s) => s.type === "image").length >= 6, d.ok ? `${d.data.sections.length}블록, ${((Date.now() - t0) / 1000).toFixed(0)}초` : d.error);
  if (d.ok) {
    const all = d.data.sections.map((s) => ("text" in s ? s.text : "") + ("caption" in s && s.caption ? s.caption : "")).join("\n");
    ok("초안 텍스트에 마크다운 기호 유출 0", markdownLeaks(all).length === 0, markdownLeaks(all).join(","));
    const hls = d.data.sections.filter((s) => s.type === "paragraph" && s.highlight).length;
    const san = sanitizeDraft(d.data);
    const bad = san.draft.sections.filter((s) => s.type === "paragraph" && s.highlight && !s.text.includes(s.highlight)).length;
    ok("highlight 가 전부 같은 문단 안에 글자 그대로 있다(없는 건 버려짐)", bad === 0, `강조 ${hls}개 중 ${san.droppedHighlights}개 버림`);
    fs.writeFileSync(path.join(tmp, "draft.json"), JSON.stringify(san.draft, null, 2));
    console.log("  초안 제목:", d.data.title);
  }

  // ③ 내 사진: 자연순 정렬 + 설명 1회 + 정확히 N자리 + 배치
  const photos = listLocalPhotos(photoDir);
  ok("파일명 자연순(사진1, 사진2, 사진10)", photos.map((p) => p.name).join(",") === "사진1.png,사진2.png,사진10.png");
  const before = claudeCallCount();
  const descs = await describePhotos(photos);
  const afterDesc = claudeCallCount();
  ok("사진 설명은 사진당 1회", afterDesc - before === photos.length, descs.map((x) => x.desc).join(" / "));
  const r = await runClaudeJson(
    modePrompt("review", "동네 카페 방문 후기", "라떼 6,000원, 창가 자리가 좋음, 주말 웨이팅 20분", photoHintFor("local", photos.length, descs)),
    draftSchemaFor("local", photos.length),
  );
  ok("체험단: 이미지 자리 정확히 사진 장수(3)", r.ok, r.ok ? `${r.data.sections.length}블록` : r.error);
  if (r.ok) {
    const slots = r.data.sections.filter((s) => s.type === "image") as Array<{ query: string; caption?: string | null }>;
    const assign = await placePhotos(slots, descs, "ai");
    ok("배치: 모든 자리에 서로 다른 사진", new Set(assign).size === photos.length && assign.every((i) => i >= 0), JSON.stringify(assign));
    console.log("  자리→사진:", slots.map((s, i) => `${s.query.slice(0, 20)} → ${descs[assign[i]].desc}`).join(" | "));
    ok("본문 생성 이후 사진 설명을 다시 만들지 않음(설명 호출 총 3회)", claudeCallCount() - before === photos.length + 2, `총 ${claudeCallCount() - before}회 = 설명 ${photos.length} + 본문 1 + 배치 1`);
  }

  console.log(fail ? `\n${fail}개 실패` : "\n전부 통과");
  console.log("초안 저장:", path.join(tmp, "draft.json"));
  process.exit(fail ? 1 : 0);
}
main();
