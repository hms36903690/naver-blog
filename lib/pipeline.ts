import fs from "node:fs";
import path from "node:path";
import { hasCloudflare } from "@/config";
import { generateDraft, generateIdeas, sanitizeDraft } from "./ai/content";
import { generateForSlot } from "./ai/imagegen";
import { modePrompt, photoHintFor } from "./ai/templates";
import { runClaudeJson } from "./claude";
import { countTistoryDraftsThisWeek, getDb, setJobStage } from "./db";
import { describePhotos, listLocalPhotos, placePhotos, type LocalPhoto, type PhotoDesc } from "./localPhotos";
import { jobLog } from "./log";
import { checkPublishGuard, publishDraft, type PublishResult } from "./naver/publish";
import { appendNaverCta } from "./cta";
import { appendComplianceNotice, scanCompliance } from "./compliance";
import { verifySession } from "./naver/session";
import { saveTistoryDraft } from "./tistory/draft";
import { exportPhotosForUpload } from "./tistory/html";
import { verifyTistory } from "./tistory/session";
import { paths } from "./paths";
import { newContext } from "./playwright";
import { findImageForSlot, type SeenImages } from "./scrape/images";
import { scrapeTrends } from "./scrape/trends";
import { getSettings } from "./settings";
import { bodyChars, CATEGORY_LABEL, categoryFromLabel, cleanTags, draftSchemaFor, type Draft, type ImageStyle, type JobInput, type PhotoSource, type Source } from "./types";

const PUBLISH_CAP_MS = 15 * 60 * 1000;

export function createJob(input: JobInput): number {
  const r = getDb()
    .prepare("INSERT INTO jobs (keyword, status, stage, auto, mode, inputs) VALUES (?, 'pending', '대기', ?, ?, ?)")
    .run(input.keyword, input.mode === "auto" ? 1 : 0, input.mode, JSON.stringify(input));
  return Number(r.lastInsertRowid);
}

/** ±3 섹션에서 문단 2개(400자) — 사진 자리의 앞뒤 맥락 */
function contextAround(d: Draft, idx: number): string {
  const near = d.sections
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => Math.abs(i - idx) <= 3 && (s.type === "paragraph" || s.type === "quote" || s.type === "heading"))
    .sort((a, b) => Math.abs(a.i - idx) - Math.abs(b.i - idx))
    .slice(0, 2)
    .map(({ s }) => ("text" in s ? s.text : ""));
  return near.join(" / ").slice(0, 400);
}

function insertImageRow(row: {
  jobId: number;
  draftId: number;
  query: string;
  src?: string | null;
  local?: string | null;
  site: "naver" | "google" | "ai" | "local";
  ok: boolean;
  reason: string;
  idx: number;
  genPrompt?: string | null;
}) {
  getDb()
    .prepare(
      `INSERT INTO images (job_id, draft_id, query, src_url, local_path, source_site, verdict_ok, verdict_reason, section_index, gen_prompt)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(row.jobId, row.draftId, row.query, row.src ?? null, row.local ?? null, row.site, row.ok ? 1 : 0, row.reason, row.idx, row.genPrompt ?? null);
}

/**
 * ⚠️ photoDescs 는 인자로 받는다. 내부에서 만들지 마라 — 본문 생성 단계에서 만든 사진 설명을 재사용해야
 *   claude 호출이 배로 들지 않는다(실제 구현자가 처음에 그렇게 짰다).
 */
export async function fillImages(
  jobId: number,
  draftId: number,
  draft: Draft,
  opts: { photoSource: PhotoSource; imageStyle: ImageStyle; photos: LocalPhoto[]; photoDescs: PhotoDesc[]; placement: "order" | "ai" },
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const slots = draft.sections.map((s, i) => ({ s, i })).filter(({ s }) => s.type === "image") as Array<{
    s: Extract<Draft["sections"][number], { type: "image" }>;
    i: number;
  }>;
  if (!slots.length || opts.photoSource === "none") return out;
  const s = getSettings();
  const log = (m: string, lvl: "info" | "warn" = "info") => jobLog(jobId, m, lvl);

  if (opts.photoSource === "local") {
    const assign = await placePhotos(slots.map(({ s: sec }) => sec), opts.photoDescs, opts.placement);
    // 미리보기(/api/file 은 data 폴더만 서빙)와 업로드를 위해 data 안으로 복사해 둔다
    const dir = path.join(paths.images, `job${jobId}`);
    fs.mkdirSync(dir, { recursive: true });
    assign.forEach((pi, k) => {
      const p = opts.photos[pi];
      if (!p) return;
      const dest = path.join(dir, `local-${k}${path.extname(p.name).toLowerCase()}`);
      fs.copyFileSync(p.path, dest);
      out.set(slots[k].i, dest);
      insertImageRow({ jobId, draftId, query: slots[k].s.query, src: p.path, local: dest, site: "local", ok: true, reason: `내 사진: ${p.name}`, idx: slots[k].i });
    });
    log(`내 사진 ${out.size}장을 자리에 배치했습니다(${opts.placement === "ai" ? "내용 맞춤" : "순서대로"})`);
    return out;
  }

  if (opts.photoSource === "ai") {
    if (!hasCloudflare()) {
      log("Cloudflare 열쇠가 없어 사진 생성을 건너뜁니다", "warn");
      return out;
    }
    for (let k = 0; k < slots.length; k++) {
      const { s: sec, i } = slots[k];
      const r = await generateForSlot({
        jobId,
        title: draft.title,
        scene: [sec.query, sec.caption].filter(Boolean).join(" — "),
        context: contextAround(draft, i),
        style: opts.imageStyle,
        steps: s.cfImageSteps,
        slotIndex: k,
        log,
      });
      insertImageRow({
        jobId,
        draftId,
        query: sec.query,
        local: r.ok ? r.path : null,
        site: "ai",
        ok: r.ok,
        reason: r.ok ? "생성 통과" : r.reason,
        idx: i,
        genPrompt: r.prompt,
      });
      if (r.ok) out.set(i, r.path);
      log(`AI 사진 ${k + 1}/${slots.length}: ${r.ok ? "채택" : `건너뜀(${r.reason.slice(0, 60)})`}`, r.ok ? "info" : "warn");
    }
    return out;
  }

  // crawl
  const { browser, context } = await newContext({ headless: !s.showBrowser, useNaverSession: false });
  const seen: SeenImages = new Map();
  try {
    for (let k = 0; k < slots.length; k++) {
      const { s: sec, i } = slots[k];
      const r = await findImageForSlot({
        seen,
        context,
        query: sec.query,
        textContext: contextAround(draft, i),
        maxCandidates: s.imageCandidates,
        outDir: path.join(paths.images, `job${jobId}`),
        slotIndex: k,
        onCandidate: (c) =>
          insertImageRow({ jobId, draftId, query: sec.query, src: c.srcUrl, local: c.localPath, site: c.site, ok: c.ok, reason: c.reason, idx: i }),
      });
      if (r.chosen?.localPath) out.set(i, r.chosen.localPath);
      const rej = r.tried.filter((t) => !t.ok).length;
      log(
        `사진 ${k + 1}/${slots.length} "${sec.query}": ${r.chosen ? "채택" : "못 찾음"}${rej ? ` (탈락 ${rej}장)` : ""}${r.skipped ? ` (유료·중복 ${r.skipped}장은 AI 판정 생략)` : ""}`,
        r.chosen ? "info" : "warn",
      );
      if (r.tried.some((t) => /판정 실패:.*limit/i.test(t.reason))) {
        log("AI 사용 한도에 걸려 남은 사진 찾기를 멈춥니다", "warn");
        break;
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return out;
}

function recordPost(jobId: number, draftId: number, r: { status: string; url?: string; screenshot?: string; note: string }) {
  getDb()
    .prepare(
      `INSERT INTO posts (job_id, draft_id, status, blog_url, screenshot, note, published_at)
       VALUES (?,?,?,?,?,?, CASE WHEN ?='published' THEN datetime('now') ELSE NULL END)`,
    )
    .run(jobId, draftId, r.status, r.url ?? null, r.screenshot ?? null, r.note, r.status);
}

/** fire-and-forget. API 라우트에서 await 하지 말고 .catch(console.error) 만 붙인다. */
export async function runJob(jobId: number): Promise<void> {
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(jobId) as { inputs: string } | undefined;
  if (!job) return;
  const input = JSON.parse(job.inputs) as JobInput;
  const log = (m: string, lvl: "info" | "warn" | "error" | "ok" = "info") => jobLog(jobId, m, lvl);
  const settings = getSettings();
  const target = input.target ?? "naver";
  const onRetry = (why: string) => log(`AI 응답이 형식에 맞지 않아 다시 요청합니다 (${why.slice(0, 80)})`, "warn");

  try {
    let draft: Draft;
    let ideaId: number | null = null;
    let photos: LocalPhoto[] = [];
    let photoDescs: PhotoDesc[] = [];

    if (input.mode === "auto") {
      // 수집 → 글감 → 본문
      let sources: Source[];
      if (input.sources) {
        sources = input.sources; // 제목 추천 때 모은 자료 재사용
      } else {
        setJobStage(jobId, "scraping", "자료 모으는 중");
        log(`"${input.keyword}" 관련 뉴스·블로그를 모읍니다`);
        sources = await scrapeTrends(input.keyword, settings.scrapeTopN, { headless: !settings.showBrowser, log });
      }
      const ins = db.prepare("INSERT INTO sources (job_id, type, title, summary, url) VALUES (?,?,?,?,?)");
      for (const s of sources) ins.run(jobId, s.type, s.title, s.summary, s.url);
      if (!sources.length) log("모은 자료가 없습니다 — 키워드만으로 글감을 만듭니다", "warn");

      const insIdea = db.prepare("INSERT INTO ideas (job_id, title, angle, rationale, chosen) VALUES (?,?,?,?,?)");
      let chosen;
      if (input.idea) {
        chosen = input.idea;
        ideaId = Number(insIdea.run(jobId, chosen.title, chosen.angle, chosen.rationale, 1).lastInsertRowid);
        log(`고른 제목으로 씁니다: ${chosen.title}`);
      } else {
        setJobStage(jobId, "writing", "글감 고르는 중");
        const ideas = await generateIdeas(input.keyword, sources, 5, onRetry, target, settings.tistoryStyle, input.category);
        if (!ideas.ok) throw new Error(`글감 만들기 실패: ${ideas.error}`);
        ideas.data.forEach((it, i) => {
          const r = insIdea.run(jobId, it.title, it.angle, it.rationale, i === 0 ? 1 : 0);
          if (i === 0) ideaId = Number(r.lastInsertRowid);
        });
        chosen = ideas.data[0];
        log(`글감 ${ideas.data.length}개 중 1등: ${chosen.title}`);
      }

      setJobStage(jobId, "writing", "본문 쓰는 중");
      const d = await generateDraft(input.keyword, chosen, sources, input.photoSource, onRetry, target, settings.tistoryStyle, input.category, settings.naverAuthorBio);
      if (!d.ok) throw new Error(`본문 쓰기 실패: ${d.error}`);
      draft = d.data;
    } else {
      // 유형별: (로컬사진 목록·설명) → 본문
      if (input.photoSource === "local") {
        photos = listLocalPhotos(input.photoFolder);
        if (!photos.length) throw new Error("사진 폴더에 사진(jpg·png·webp·heic)이 없습니다.");
        log(`내 사진 ${photos.length}장을 찾았습니다`);
        setJobStage(jobId, "writing", "사진 살펴보는 중");
        // ⚠️ 본문 생성 전에 한 번만 — 이후 프롬프트와 배치에 재사용(6-8, 6-10)
        photoDescs = await describePhotos(photos, log);
      }
      setJobStage(jobId, "writing", "본문 쓰는 중");
      const prompt = modePrompt(
        input.mode,
        input.keyword,
        input.details,
        photoHintFor(input.photoSource, photos.length, photoDescs, target),
        target,
        settings.tistoryStyle,
        input.category,
        settings.naverAuthorBio,
      );
      const d = await runClaudeJson(prompt, draftSchemaFor(input.photoSource, photos.length, target), { onRetry });
      if (!d.ok) throw new Error(`본문 쓰기 실패: ${d.error}`);
      draft = d.data;
    }

    // ⚠️ 7-24: 지어낸 highlight 는 개별로 떨어뜨린다(초안 전체 반려 X)
    const san = sanitizeDraft(draft);
    draft = san.draft;
    if (san.droppedHighlights) log(`본문에 없는 강조 구절 ${san.droppedHighlights}개를 뺐습니다`, "warn");
    // 카테고리: 사용자가 골랐으면 그것, 아니면 AI 가 글에 맞게 고른 것(블로그 카테고리 목록에 맞춰 정리)
    const decidedCat = input.category ?? categoryFromLabel(draft.category, target);
    const catLabel = decidedCat ? CATEGORY_LABEL[decidedCat] : null;
    if (catLabel) log(`카테고리: ${catLabel}${input.category ? "" : " (글 내용에 맞게 AI가 골랐습니다)"}`);
    const tags = cleanTags(draft.tags);
    if (tags.length) log(`태그 ${tags.length}개: ${tags.map((t) => "#" + t).join(" ")}`);
    const dr = db
      .prepare("INSERT INTO drafts (job_id, idea_id, title, body_json, category, tags) VALUES (?,?,?,?,?,?)")
      .run(jobId, ideaId, draft.title, JSON.stringify(draft.sections), catLabel, JSON.stringify(tags));
    const draftId = Number(dr.lastInsertRowid);
    log(`초안 완성: "${draft.title}" (본문 ${bodyChars(draft).toLocaleString()}자, ${draft.sections.length}개 블록)`, "ok");

    // 사진
    let images = new Map<number, string>();
    if (input.photoSource !== "none") {
      setJobStage(jobId, "imaging", input.photoSource === "ai" ? "사진 그리는 중" : input.photoSource === "crawl" ? "사진 찾는 중" : "사진 배치 중");
      images = await fillImages(jobId, draftId, draft, {
        photoSource: input.photoSource,
        imageStyle: input.imageStyle,
        photos,
        photoDescs,
        placement: input.photoPlacement,
      });
      const slots = draft.sections.filter((s) => s.type === "image").length;
      log(`사진 ${images.size}/${slots}자리 채움${images.size < slots ? ` — 빈 ${slots - images.size}자리는 사진 없이 올라갑니다` : ""}`);
    }

    // 네이버 인바운드: 글 끝에 상담 신청 안내(설정에 신청서 주소가 있을 때만)
    if (target === "naver" && settings.naverCtaUrl) {
      draft = appendNaverCta(draft, settings.naverCtaText, settings.naverCtaUrl);
      db.prepare("UPDATE drafts SET body_json=? WHERE id=?").run(JSON.stringify(draft.sections), draftId);
      log("글 끝에 상담 신청 안내를 붙였습니다");
    }

    await publishStage({ jobId, draftId, draft, images, input, catLabel, tags, log });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    log(msg, "error");
    setJobStage(jobId, "failed", "실패", msg);
  }
}

type LogFn = (m: string, lvl?: "info" | "warn" | "error" | "ok") => void;

/**
 * 발행 단계만(글·그림은 이미 있다). runJob 의 마지막 단계이자 [다시 시도]가 쓰는 함수.
 * 글을 새로 쓰지 않으므로 AI 사용량이 들지 않는다.
 */
async function publishStage(c: {
  jobId: number;
  draftId: number;
  draft: Draft;
  images: Map<number, string>;
  input: JobInput;
  catLabel: string | null;
  tags: string[];
  log: LogFn;
}): Promise<void> {
  const { jobId, draftId, images, input, catLabel, tags, log } = c;
  const target = input.target ?? "naver";
  const settings = getSettings();
  // 보험설계사용 안전장치: 문제 표현 검사 + 심의필 문구 첨부(저장된 초안은 그대로 — 다시 시도 때 두 번 붙지 않게)
  // 네이버에만 적용(티스토리는 순수 정보성 블로그 — 사용자 지정)
  const comply = settings.complianceMode && target === "naver";
  const hits = comply ? scanCompliance(c.draft) : [];
  if (hits.length) log(`심의에서 문제 될 수 있는 표현 ${hits.length}개: ${hits.map((h) => `"${h.word}"(${h.kind})`).join(", ")}`, "warn");
  const draft = comply ? appendComplianceNotice(c.draft, settings.complianceNotice) : c.draft;
  // 티스토리: 반자동 — 임시저장까지만(발행은 사람이)
  if (target === "tistory") {
    const nowT = getSettings();
    if (nowT.killSwitch) {
      recordPost(jobId, draftId, { status: "blocked", note: "전체 중단이 켜져 있어 티스토리에 저장하지 않았습니다." });
      setJobStage(jobId, "done", "막힘");
      return;
    }
    if (!nowT.dryRun && countTistoryDraftsThisWeek() >= nowT.tistoryWeeklyLimit) {
      const note = `이번 주 티스토리 ${nowT.tistoryWeeklyLimit}편을 모두 채워 저장하지 않았습니다. 다음 주 월요일부터 다시 저장됩니다(설정에서 바꿀 수 있습니다).`;
      recordPost(jobId, draftId, { status: "blocked", note });
      log(note, "warn");
      setJobStage(jobId, "done", "이번 주 한도");
      return;
    }
    setJobStage(jobId, "publishing", nowT.dryRun ? "연습: 티스토리 글쓰기 화면에 입력 중" : "티스토리에 임시저장 중");
    const ts = await verifyTistory();
    if (ts.state !== "valid") {
      recordPost(jobId, draftId, { status: "failed", note: ts.message });
      log(ts.message, "error");
      setJobStage(jobId, "failed", "티스토리 로그인 필요", ts.message);
      return;
    }
    const upDir = path.join(paths.images, `job${jobId}`, "올릴사진");
    const exported = exportPhotosForUpload(draft, images, upDir);
    if (exported.length) log(`올릴 사진 ${exported.length}장을 '올릴사진' 폴더에 사진 1~${exported.length} 이름으로 정리했습니다`);
    const tr = await Promise.race([
      saveTistoryDraft({ jobId, blog: ts.blog, draft, images, dryRun: nowT.dryRun, headless: !nowT.showBrowser, log }),
      new Promise<{ status: "failed"; note: string }>((res) =>
        setTimeout(() => res({ status: "failed", note: "티스토리 작업이 15분 안에 끝나지 않아 중단했습니다." }), PUBLISH_CAP_MS),
      ),
    ]);
    if (tr.status === "draft_saved" || tr.status === "draft_unverified") {
      const bc = bodyChars(draft);
      const imgs = draft.sections.filter((x) => x.type === "image").length;
      tr.note += ` (본문 ${bc.toLocaleString()}자, 사진 자리 ${imgs}곳${catLabel ? `, 카테고리: ${catLabel} — 발행할 때 티스토리 카테고리를 '${catLabel}'로 골라 주세요` : ""}${tags.length ? `, 태그 ${tags.length}개 — [태그만 복사]로 티스토리 태그 칸에 붙여넣으세요` : ""})`;
    }
    recordPost(jobId, draftId, tr);
    if (tr.status === "failed") {
      log(tr.note, "error");
      setJobStage(jobId, "failed", "티스토리 저장 실패", tr.note);
    } else {
      log(tr.note, tr.status === "draft_unverified" ? "warn" : "ok");
      setJobStage(jobId, "done", tr.status === "dry_run" ? "연습 완료" : "임시저장됨");
    }
    return;
  }

  // 발행
  setJobStage(jobId, "publishing", settings.dryRun ? "연습: 글쓰기 화면에 입력 중" : "네이버에 올리는 중");
  const now = getSettings(); // 작업 도중 바뀐 설정(연습 모드·중단)을 반영
  if (!now.dryRun && now.complianceMode) {
    // ⚠️ 보험설계사: 심의 없이 실제 발행하면 안 된다 → 심의필 문구가 없거나 문제 표현이 있으면 막는다
    const reason = !now.complianceNotice.trim()
      ? "심의필 문구가 없어 네이버에 발행하지 않았습니다. 소속 회사 심의를 받은 뒤 [설정] → 보험 광고 규정에 심의필 번호·안내 문구를 넣고 다시 시도하세요."
      : hits.length
        ? `심의에서 문제 될 수 있는 표현이 있어 발행하지 않았습니다: ${hits.map((h) => `"${h.word}"`).join(", ")}. [글 복사]로 고쳐 직접 올리거나 처음부터 다시 만들어 주세요.`
        : "";
    if (reason) {
      recordPost(jobId, draftId, { status: "blocked", note: reason });
      log(reason, "warn");
      setJobStage(jobId, "done", "발행 막힘(심의)");
      return;
    }
  }
  if (!now.dryRun) {
    const g = checkPublishGuard(now);
    if (g.blocked) {
      recordPost(jobId, draftId, { status: "blocked", note: g.reason });
      log(g.reason, "warn");
      setJobStage(jobId, "done", "발행 막힘");
      return;
    }
  }
  const sess = await verifySession();
  if (sess.state !== "valid") {
    const note =
      sess.state === "none"
        ? "네이버 로그인이 필요합니다. 화면 위 [네이버 로그인]을 눌러주세요."
        : sess.state === "write_expired"
          ? "글쓰기 로그인이 풀렸습니다. [네이버 로그인]을 다시 눌러주시고 '로그인 상태 유지'를 꼭 체크해 주세요."
          : `네이버 로그인 확인 실패: ${sess.message}`;
    recordPost(jobId, draftId, { status: "failed", note });
    log(note, "error");
    setJobStage(jobId, "failed", "로그인 필요", note);
    return;
  }

  const result = await Promise.race<PublishResult>([
    publishDraft({
      jobId,
      draft,
      images,
      blogId: sess.blogId,
      dryRun: now.dryRun,
      visibility: now.visibility,
      headless: !now.showBrowser,
      headingAsQuote: input.mode !== "auto",
      log,
    }),
    new Promise<PublishResult>((res) =>
      setTimeout(() => res({ status: "failed", note: "글쓰기가 15분 안에 끝나지 않아 중단했습니다. 글은 임시저장 상태로 남아 있을 수 있습니다." }), PUBLISH_CAP_MS),
    ),
  ]);
  if (catLabel && result.status !== "blocked") result.note += ` (카테고리: ${catLabel} — 네이버 블로그에서 이 카테고리로 옮겨 주세요)`;
  recordPost(jobId, draftId, result);
  if (result.status === "published") {
    log(`발행 완료: ${result.url}`, "ok");
    setJobStage(jobId, "done", "발행됨");
  } else if (result.status === "dry_run") {
    log("연습 완료 — 실제로 올리지 않았습니다. 완성 화면을 저장했습니다", "ok");
    setJobStage(jobId, "done", "연습 완료");
  } else {
    log(result.note, "error");
    setJobStage(jobId, "failed", "발행 실패", result.note);
  }
}

/**
 * [다시 시도] — 저장된 글·그림으로 발행 단계만 다시 한다(글을 새로 쓰지 않음).
 */
export async function retryPublish(jobId: number): Promise<void> {
  const db = getDb();
  const log: LogFn = (m, lvl = "info") => jobLog(jobId, m, lvl);
  try {
    const job = db.prepare("SELECT inputs FROM jobs WHERE id=?").get(jobId) as { inputs: string } | undefined;
    const d = db.prepare("SELECT id, title, body_json, category, tags FROM drafts WHERE job_id=? ORDER BY id DESC LIMIT 1").get(jobId) as
      | { id: number; title: string; body_json: string; category: string | null; tags: string | null }
      | undefined;
    if (!job || !d) throw new Error("다시 올릴 글이 없습니다. 처음부터 다시 만들어 주세요.");
    const input = JSON.parse(job.inputs) as JobInput;
    const draft: Draft = { title: d.title, sections: JSON.parse(d.body_json), category: d.category, tags: d.tags ? JSON.parse(d.tags) : [] };
    const images = new Map<number, string>();
    for (const r of db
      .prepare("SELECT section_index, local_path FROM images WHERE job_id=? AND draft_id=? AND verdict_ok=1 AND local_path IS NOT NULL ORDER BY id")
      .all(jobId, d.id) as Array<{ section_index: number; local_path: string }>) {
      if (fs.existsSync(r.local_path) && !images.has(r.section_index)) images.set(r.section_index, r.local_path);
    }
    log(`다시 시도합니다 — 이미 쓴 글과 그림(${images.size}장)을 그대로 씁니다`);
    await publishStage({ jobId, draftId: d.id, draft, images, input, catLabel: d.category, tags: draft.tags ?? [], log });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    log(msg, "error");
    setJobStage(jobId, "failed", "실패", msg);
  }
}
