"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { diagnoseFailure, type FixAction } from "@/lib/failure";
import { POST_LABEL, STATUS_LABEL, VISIBILITY_LABEL } from "@/lib/labels";
import SettingsDrawer, { type Limits, type Settings } from "./SettingsDrawer";

type Status = {
  claude: { ok: boolean; version?: string; error?: string };
  naver: { state: string; message: string; blogId?: string; loginInFlight?: boolean };
  tistory: { state: string; message: string; blog?: string; loginInFlight?: boolean };
  cloudflare: { configured: boolean };
  settings: Settings;
  limits: Limits;
  platform: string;
  dataRoot?: string;
};
type Usage = {
  publishedToday: number;
  dailyLimit: number;
  minIntervalMin: number;
  neurons: number;
  neuronsMeasured: boolean;
  neuronsNote: string | null;
  neuronsLimit: number;
  perImage: number;
  tistoryThisWeek?: number;
  tistoryWeeklyLimit?: number;
};
type JobRow = { id: number; keyword: string; status: string; stage: string | null; mode: string; created_at: string; post_status: string | null };
type Section =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string; highlight?: string | null }
  | { type: "quote"; text: string }
  | { type: "divider" }
  | { type: "image"; query: string; caption?: string | null };
type ImageRow = { id: number; query: string; local_path: string | null; source_site: string; verdict_ok: number; verdict_reason: string; section_index: number };
type JobDetail = {
  job: { id: number; keyword: string; status: string; stage: string | null; error: string | null; mode: string; inputs?: string };
  ideas: Array<{ id: number; title: string; angle: string; chosen: number }>;
  sources: Array<{ id: number; type: string; title: string; url: string }>;
  draft: { title: string; sections: Section[]; category?: string | null; tags?: string[] } | null;
  images: ImageRow[];
  post: { status: string; blog_url: string | null; screenshot: string | null; note: string | null } | null;
  logs: Array<{ id: number; level: string; message: string }>;
};

type Mode = "auto" | "review" | "branding";
type Target = "naver" | "tistory";
type PhotoSource = "local" | "crawl" | "ai" | "none";
const ACTIVE = ["pending", "scraping", "writing", "imaging", "publishing"];
const MODES: Array<{ id: Mode; name: string; desc: string }> = [
  { id: "auto", name: "자동 발굴", desc: "관심 키워드만 넣으면 요즘 화제를 찾아 글을 씁니다" },
  { id: "review", name: "체험단", desc: "방문·사용 후기를 1인칭으로 씁니다" },
  { id: "branding", name: "브랜딩·전문성", desc: "전문가 시선으로 신뢰를 쌓는 글을 씁니다" },
];
const PHOTO: Array<{ id: PhotoSource; name: string }> = [
  { id: "local", name: "내 사진" },
  { id: "crawl", name: "검색해서 가져오기" },
  { id: "ai", name: "AI가 그리기" },
  { id: "none", name: "사진 없음" },
];

const fileUrl = (p: string) => `/api/file?path=${encodeURIComponent(p)}`;

function renderParagraph(text: string, hl?: string | null) {
  const at = hl ? text.indexOf(hl) : -1;
  if (!hl || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{hl}</mark>
      {text.slice(at + hl.length)}
    </>
  );
}

/** [글 복사] — 붙여넣을 곳에서 서식이 살도록 HTML 과 일반 글자를 함께 클립보드에 넣는다 */
function draftToClipboard(d: NonNullable<JobDetail["draft"]>, images: ImageRow[]): { html: string; text: string } {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const has = new Set(images.filter((i) => i.verdict_ok && i.local_path).map((i) => i.section_index));
  const html: string[] = [`<h1>${esc(d.title)}</h1>`];
  const text: string[] = [d.title, ""];
  let n = 0;
  d.sections.forEach((s, i) => {
    switch (s.type) {
      case "heading":
        html.push(`<h2>${esc(s.text)}</h2>`);
        text.push(s.text, "");
        break;
      case "paragraph": {
        const at = s.highlight ? s.text.indexOf(s.highlight) : -1;
        html.push(
          at < 0 ? `<p>${esc(s.text)}</p>` : `<p>${esc(s.text.slice(0, at))}<b>${esc(s.highlight!)}</b>${esc(s.text.slice(at + s.highlight!.length))}</p>`,
        );
        text.push(s.text, "");
        break;
      }
      case "quote":
        html.push(`<blockquote>${esc(s.text)}</blockquote>`);
        text.push(s.text, "");
        break;
      case "divider":
        html.push("<hr>");
        text.push("────────", "");
        break;
      case "image":
        if (!has.has(i)) break; // 사진을 못 구한 자리는 뺀다
        n++;
        html.push(`<p>[사진 ${n}${s.caption ? ` — ${esc(s.caption)}` : ""}]</p>`);
        text.push(`[사진 ${n}${s.caption ? ` — ${s.caption}` : ""}]`, "");
        break;
    }
  });
  const tags = (d.tags ?? []).map((t) => "#" + t).join(" ");
  if (tags) {
    html.push(`<p>${esc(tags)}</p>`);
    text.push(tags);
  }
  return { html: html.join("\n"), text: text.join("\n").trim() };
}

function CopyButton({ d, images }: { d: NonNullable<JobDetail["draft"]>; images: ImageRow[] }) {
  const [msg, setMsg] = useState("");
  async function copy() {
    const { html, text } = draftToClipboard(d, images);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
      ]);
      setMsg("복사했습니다. 붙여넣을 곳에서 Ctrl + V 를 누르세요.");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setMsg("글자만 복사했습니다(서식 없이). 붙여넣을 곳에서 Ctrl + V 를 누르세요.");
      } catch {
        setMsg("복사하지 못했습니다. 미리보기 글을 마우스로 끌어서 복사해 주세요.");
      }
    }
    setTimeout(() => setMsg(""), 6000);
  }
  async function copyTags() {
    try {
      await navigator.clipboard.writeText((d.tags ?? []).map((t) => "#" + t).join(" "));
      setMsg("태그를 복사했습니다. 블로그의 태그 칸에 Ctrl + V 로 붙여넣으세요.");
    } catch {
      setMsg("복사하지 못했습니다. 아래 태그를 마우스로 끌어서 복사해 주세요.");
    }
    setTimeout(() => setMsg(""), 6000);
  }
  return (
    <div className="row" style={{ margin: "8px 0", flexWrap: "wrap" }}>
      <button type="button" className="btn" onClick={copy}>
        글 복사 📋
      </button>
      {(d.tags ?? []).length > 0 && (
        <button type="button" className="btn" onClick={copyTags}>
          태그만 복사 #
        </button>
      )}
      <span className="hint">{msg || "제목·본문을 서식(소제목·굵게)과 함께 복사합니다. 사진 자리는 [사진 1]처럼 표시됩니다."}</span>
    </div>
  );
}

function Preview({ d, images, headingAsQuote }: { d: NonNullable<JobDetail["draft"]>; images: ImageRow[]; headingAsQuote: boolean }) {
  const chosen = new Map(images.filter((i) => i.verdict_ok && i.local_path).map((i) => [i.section_index, i]));
  return (
    <article className="preview">
      <h1>{d.title}</h1>
      {d.sections.map((s, i) => {
        switch (s.type) {
          case "heading":
            return headingAsQuote ? <blockquote key={i}>{s.text}</blockquote> : <h3 key={i}>{s.text}</h3>;
          case "paragraph":
            return <p key={i}>{renderParagraph(s.text, s.highlight)}</p>;
          case "quote":
            return <blockquote key={i}>{s.text}</blockquote>;
          case "divider":
            return <hr key={i} />;
          case "image": {
            const img = chosen.get(i);
            return img ? (
              <figure key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(img.local_path!)} alt={s.caption || s.query} />
                {s.caption && <figcaption>{s.caption}</figcaption>}
              </figure>
            ) : (
              <div key={i} className="slot">사진 자리 — {s.query} (비어 있음)</div>
            );
          }
        }
      })}
    </article>
  );
}

function statusSig(j: { status: string; post_status?: string | null }) {
  if (ACTIVE.includes(j.status)) return "live";
  if (j.status === "failed" || j.post_status === "failed" || j.post_status === "blocked") return "armed";
  if (j.post_status === "published") return "armed";
  if (j.post_status === "dry_run" || j.post_status === "draft_saved") return "safe";
  if (j.post_status === "draft_unverified") return "live";
  return "dim";
}

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [mode, setMode] = useState<Mode>("auto");
  const [target, setTargetState] = useState<Target>("naver");
  useEffect(() => {
    try {
      const t = localStorage.getItem("target");
      if (t === "naver" || t === "tistory") setTargetState(t);
    } catch {}
  }, []);
  const setTarget = (t: Target) => {
    setTargetState(t);
    setCategory(null);
    try {
      localStorage.setItem("target", t);
    } catch {}
  };
  const [tsLoggingIn, setTsLoggingIn] = useState(false);
  type Idea = { title: string; angle: string; rationale: string };
  type Src = { type: "news" | "blog"; title: string; summary: string; url: string };
  const [ideas, setIdeas] = useState<{ busy: boolean; list: Idea[]; sources: Src[]; err?: string; forKey?: string }>({ busy: false, list: [], sources: [] });
  const [pickedIdea, setPickedIdea] = useState<number | null>(null);
  async function suggest() {
    if (!keyword.trim()) return;
    setPickedIdea(null);
    setIdeas({ busy: true, list: [], sources: [] });
    const r = await fetch("/api/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyword, target, ...(category ? { category } : {}) }) });
    const j = await r.json();
    if (!r.ok) return setIdeas({ busy: false, list: [], sources: [], err: j.error || "추천 실패" });
    setIdeas({ busy: false, list: j.ideas, sources: j.sources, forKey: `${keyword}|${target}|${category}` });
  }
  const [keyword, setKeyword] = useState("");
  // 카테고리(사용자 지정) — 올릴 곳마다 다르다
  //   티스토리: 건강정보 / 금융·재테크 / 생활경제 (사용자 블로그의 실제 카테고리 이름)
  //   네이버: 사업자 정보(세금·자금·임금·임대료·증여·상속·재무)
  type Category = "life" | "money" | "health" | "tax" | "fund" | "wage" | "rent" | "inherit" | "finance";
  const TS_CATS: Array<{ id: Category; name: string; desc: string; kw: string }> = [
    { id: "health", name: "건강정보", desc: "전문성을 쌓고 독자를 확보하는 글", kw: "건강" },
    { id: "money", name: "금융·재테크", desc: "자산관리와 경제 관련 글", kw: "재테크" },
    { id: "life", name: "생활경제", desc: "검색 유입을 위한 생활·돈 정보", kw: "생활경제" },
  ];
  const NV_CATS: Array<{ id: Category; name: string; desc: string; kw: string }> = [
    { id: "tax", name: "세금", desc: "부가세·종소세·법인세 신고와 절세", kw: "사업자 세금" },
    { id: "fund", name: "자금", desc: "정책자금·대출·지원금", kw: "소상공인 정책자금" },
    { id: "wage", name: "임금·노무", desc: "최저임금·주휴수당·4대보험·퇴직금", kw: "사업주 인건비" },
    { id: "rent", name: "임대료", desc: "상가 임대차·임대료·권리금", kw: "상가 임대료" },
    { id: "inherit", name: "증여·상속", desc: "가업승계·증여세·상속세", kw: "사업자 증여 상속" },
    { id: "finance", name: "재무", desc: "장부·경비·현금흐름·재무제표", kw: "사업자 재무관리" },
  ];
  const CATS = target === "tistory" ? TS_CATS : NV_CATS;
  const [category, setCategory] = useState<Category | null>(null);
  function pickCategory(c: Category) {
    const next = category === c ? null : c;
    setCategory(next);
    // 자동 발굴에서 키워드가 비었거나 다른 카테고리 기본 키워드면 이 카테고리 키워드로
    if (next && mode === "auto" && (!keyword.trim() || CATS.some((x) => x.kw === keyword))) setKeyword(CATS.find((x) => x.id === next)!.kw);
  }
  const [details, setDetails] = useState("");
  // 처음 켤 때 기본값은 "AI가 그리기"(저작권 걱정 없음). Cloudflare 열쇠가 없으면 아래에서 "사진 없음"으로 바꾼다.
  const [photoSource, setPhotoSource] = useState<PhotoSource>("ai");
  // 건강·금융 글에는 일러스트가 깔끔하고 깨진 글자도 적다(실측: 계기판류 실사 4/7, 일러스트 5/5 통과)
  const [imageStyle, setImageStyle] = useState<"photo" | "illust">("illust");
  const [photoFolder, setPhotoFolder] = useState("");
  const [placement, setPlacement] = useState<"ai" | "order">("ai");
  const [starting, setStarting] = useState(false); // ⚠️ 7-16: 연타 방지 잠금
  const [formErr, setFormErr] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [liveLogs, setLiveLogs] = useState<JobDetail["logs"]>([]);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginMsg, setLoginMsg] = useState("");
  const logBox = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async (refresh = false) => {
    const r = await fetch(`/api/status${refresh ? "?refresh=1" : ""}`);
    if (r.ok) setStatus(await r.json());
  }, []);
  const loadUsage = useCallback(async () => {
    const r = await fetch("/api/usage");
    if (r.ok) setUsage(await r.json());
  }, []);
  const loadJobs = useCallback(async () => {
    const r = await fetch("/api/jobs");
    if (r.ok) setJobs((await r.json()).jobs);
  }, []);
  const [reloadKey, setReloadKey] = useState(0); // [다시 시도] 후 SSE 를 다시 연결하기 위함
  const loadDetail = useCallback(async (id: number) => {
    const r = await fetch(`/api/jobs/${id}`);
    if (r.ok) {
      const d: JobDetail = await r.json();
      setDetail(d);
      setLiveLogs(d.logs);
      return d;
    }
    return null;
  }, []);

  useEffect(() => {
    loadStatus();
    loadUsage();
    loadJobs();
  }, [loadStatus, loadUsage, loadJobs]);

  // 선택한 작업 상세 + 진행 중이면 SSE
  useEffect(() => {
    if (selected == null) return;
    let es: EventSource | null = null;
    let stop = false;
    loadDetail(selected).then((d) => {
      if (stop || !d || !ACTIVE.includes(d.job.status)) return;
      const after = d.logs.length ? d.logs[d.logs.length - 1].id : 0;
      es = new EventSource(`/api/jobs/${selected}/stream?after=${after}`);
      es.addEventListener("log", (e) => setLiveLogs((prev) => [...prev, JSON.parse((e as MessageEvent).data)]));
      es.addEventListener("stage", (e) => {
        const st = JSON.parse((e as MessageEvent).data);
        setJobs((prev) => prev.map((j) => (j.id === selected ? { ...j, ...st } : j)));
      });
      es.addEventListener("end", () => {
        es?.close();
        loadDetail(selected);
        loadJobs();
        loadUsage();
      });
    });
    return () => {
      stop = true;
      es?.close();
    };
  }, [selected, loadDetail, loadJobs, loadUsage, reloadKey]);

  // 열쇠가 없으면 AI 그리기를 쓸 수 없으므로 처음 한 번만 "사진 없음"으로
  const photoDefaultChecked = useRef(false);
  useEffect(() => {
    if (!status || photoDefaultChecked.current) return;
    photoDefaultChecked.current = true;
    if (!status.cloudflare.configured) setPhotoSource((p) => (p === "ai" ? "none" : p));
  }, [status]);

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight });
  }, [liveLogs]);

  const s = status?.settings;
  const sig = !s ? "safe" : s.killSwitch ? "armed" : s.dryRun ? "safe" : "armed";
  const railTitle = !s ? "불러오는 중…" : s.killSwitch ? "전체 중단" : s.dryRun ? "연습 모드" : target === "tistory" ? "실제 모드 (티스토리 임시저장)" : "실제 발행";
  const railSub = !s
    ? ""
    : s.killSwitch
      ? "어떤 작업도 발행되지 않습니다"
      : s.dryRun
        ? "발행하지 않고 완성 화면만 저장합니다"
        : target === "tistory"
          ? "티스토리에 임시저장합니다 — 발행은 직접 하세요"
          : "완성되는 글이 블로그에 그대로 올라갑니다";
  const isTs = target === "tistory";
  const goLabel = s?.dryRun ? "연습으로 만들기" : isTs ? "글 만들고 티스토리에 임시저장" : "글 만들고 발행하기";
  const tsOk = status?.tistory.state === "valid";
  const anyActive = jobs.some((j) => ACTIVE.includes(j.status));
  const naverOk = status?.naver.state === "valid";
  const cfMissing = photoSource === "ai" && status && !status.cloudflare.configured;
  const canRun =
    Boolean(s) && !s!.killSwitch && !starting && !anyActive && keyword.trim() && !cfMissing && !(photoSource === "local" && !photoFolder.trim()) && !(isTs && !s!.tistoryBlog);

  async function start() {
    if (!canRun) return;
    setFormErr("");
    if (s && !s.dryRun && !isTs) {
      const ok = confirm(
        `연습 모드가 꺼져 있습니다. 완성된 글이 네이버 블로그에 "${VISIBILITY_LABEL[s.visibility]}"로 실제로 올라갑니다.\n되돌릴 수 없습니다. 계속할까요?`,
      );
      if (!ok) return;
    }
    setStarting(true);
    try {
      const r = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          keyword,
          details,
          photoSource,
          imageStyle,
          photoFolder,
          photoPlacement: placement,
          target,
          ...(category ? { category } : {}),
          // 추천 목록이 있으면 고른 것(안 골랐으면 화면에 보인 1번)을 그대로 쓴다 — 다시 추천받지 않는다
          ...(mode === "auto" && ideas.list.length && ideas.forKey === `${keyword}|${target}|${category}`
            ? { idea: ideas.list[pickedIdea ?? 0], sources: ideas.sources }
            : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setFormErr(j.error || "시작하지 못했습니다");
        if (j.activeJobId) setSelected(j.activeJobId);
        return;
      }
      await loadJobs();
      setSelected(j.id);
    } finally {
      setStarting(false);
    }
  }

  /** 맨 위 줄에서 연습 ↔ 실제 전환. 실제로 바꿀 때만 한 번 확인한다(되돌릴 수 없는 쪽). */
  const [switching, setSwitching] = useState(false);
  async function toggleDryRun() {
    if (!status || switching) return;
    const toReal = status.settings.dryRun;
    if (toReal) {
      const where = isTs
        ? "티스토리에는 임시저장까지만 합니다(발행은 직접)."
        : `네이버 블로그에는 "${VISIBILITY_LABEL[status.settings.visibility]}"로 실제 발행됩니다. 되돌릴 수 없습니다.`;
      if (!confirm(`실제 모드로 바꿀까요?\n${where}`)) return;
    }
    setSwitching(true);
    try {
      const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dryRun: !toReal }) });
      if (r.ok) setStatus({ ...status, settings: (await r.json()).settings });
    } finally {
      setSwitching(false);
    }
  }

  async function login() {
    setLoggingIn(true);
    setLoginMsg("새 창에서 네이버에 로그인해 주세요. '로그인 상태 유지'를 꼭 체크해 주세요.");
    try {
      const r = await fetch("/api/naver/login", { method: "POST" });
      const j = await r.json();
      setLoginMsg(j.message || "");
      await loadStatus(true);
    } finally {
      setLoggingIn(false);
    }
  }

  async function tistoryLogin() {
    setTsLoggingIn(true);
    setLoginMsg("새 창에서 카카오 계정으로 로그인해 주세요. 카카오 로그인 화면의 \"로그인 상태 유지\"를 꼭 체크해 주세요.");
    try {
      const r = await fetch("/api/tistory/login", { method: "POST" });
      const j = await r.json();
      setLoginMsg(j.message || "");
      await loadStatus(true);
    } finally {
      setTsLoggingIn(false);
    }
  }

  /** [다시 시도] — 글·그림 그대로 발행만 다시 */
  async function retryJob(id: number) {
    const r = await fetch(`/api/jobs/${id}/retry`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) return alert(j.error || "다시 시도하지 못했습니다");
    await loadJobs();
    setReloadKey((k) => k + 1);
  }
  /** [처음부터 다시 만들기] — 같은 입력으로 새 작업 */
  async function remakeJob(inputs?: string) {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(inputs || "{}");
    } catch {}
    delete body.idea; // 고른 제목은 유지하고 싶으면 keyword 로 들어가 있다
    delete body.sources;
    const r = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) return alert(j.error || "다시 만들지 못했습니다");
    await loadJobs();
    setSelected(j.id);
  }
  /** [삭제] — 앱 기록만 지움(블로그 글은 그대로) */
  async function deleteJob(id: number) {
    if (!confirm(`#${id} 작업 기록을 앱에서 지울까요?\n\n• 블로그에 이미 올라간 글이나 티스토리 임시저장 글은 지워지지 않습니다.\n• 이 작업의 글 미리보기와 사진 파일이 앱에서 지워집니다.`)) return;
    const r = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) return alert(j.error || "지우지 못했습니다");
    setSelected(null);
    setDetail(null);
    await loadJobs();
    await loadUsage();
  }
  function runFix(a: FixAction, d: JobDetail) {
    if (a === "retry") return retryJob(d.job.id);
    if (a === "remake") return remakeJob(d.job.inputs);
    if (a === "naverLogin") return login();
    if (a === "tistoryLogin") return tistoryLogin();
    if (a === "settings") return setDrawer(true);
    if (a === "naverBlog") return window.open(status?.naver.blogId ? `https://blog.naver.com/${status.naver.blogId}` : "https://blog.naver.com/MyBlog.naver", "_blank");
    if (a === "tistoryWrite" && s?.tistoryBlog) return window.open(`https://${s.tistoryBlog}.tistory.com/manage/newpost/`, "_blank");
  }
  const FIX_LABEL: Record<FixAction, string> = {
    retry: "다시 시도 (글·그림 그대로)",
    remake: "처음부터 다시 만들기",
    naverLogin: "네이버 로그인",
    tistoryLogin: "티스토리 로그인",
    settings: "설정 열기",
    naverBlog: "내 네이버 블로그 열어 확인 ↗",
    tistoryWrite: "티스토리 임시저장 목록 열기 ↗",
  };

  async function openPhotoFolder(id: number) {
    const r = await fetch(`/api/open-folder?job=${id}`, { method: "POST" });
    if (!r.ok) alert((await r.json()).error || "폴더를 열지 못했습니다");
  }

  async function pickFolder() {
    setFormErr("");
    const r = await fetch("/api/pick-folder", { method: "POST" });
    const j = await r.json();
    if (j.path) setPhotoFolder(j.path);
    else if (j.error) setFormErr(j.error);
  }

  function meterLevel(ratio: number) {
    return ratio >= 0.9 ? "armed" : ratio >= 0.7 ? "live" : "";
  }

  const naverDot = status ? (naverOk ? "1" : status.naver.state === "none" ? "" : "0") : "";
  const pubRatio = usage ? usage.publishedToday / Math.max(1, usage.dailyLimit) : 0;
  const neuRatio = usage ? usage.neurons / usage.neuronsLimit : 0;

  return (
    <>
      <header className="rail" data-sig={sig}>
        <div>
          <div className="rail-title">{railTitle}</div>
          <div className="rail-sub">{railSub}</div>
        </div>
        {s && !s.killSwitch && (
          <div className="modeswitch" role="group" aria-label="연습 모드 / 실제 모드">
            <button type="button" aria-pressed={s.dryRun} disabled={switching} onClick={() => !s.dryRun && toggleDryRun()}>
              연습 모드
            </button>
            <button type="button" aria-pressed={!s.dryRun} disabled={switching} onClick={() => s.dryRun && toggleDryRun()}>
              실제 모드
            </button>
          </div>
        )}
        <div className="rail-spacer" />
        <div className="dots">
          <span className="dot" data-ok={status ? (status.claude.ok ? "1" : "0") : ""} title={status?.claude.version || status?.claude.error}>
            <i /> Claude
          </span>
          <span className="dot" data-ok={naverDot} title={status?.naver.message}>
            <i /> 네이버
          </span>
          <span className="dot" data-ok={status ? (tsOk ? "1" : status.tistory.state === "no_blog" || status.tistory.state === "none" ? "" : "0") : ""} title={status?.tistory.message}>
            <i /> 티스토리
          </span>
          <span className="dot" data-ok={status ? (status.cloudflare.configured ? "1" : "") : ""} title={status?.cloudflare.configured ? "열쇠 있음" : "열쇠 없음(선택)"}>
            <i /> 이미지 생성
          </span>
        </div>
        <span className="row" style={{ gap: 6 }}>
          {/* MyBlog.naver 는 브라우저에 로그인된 네이버 계정의 내 블로그로 바로 간다 */}
          <a
            className="btn"
            href={status?.naver.blogId ? `https://blog.naver.com/${status.naver.blogId}` : "https://blog.naver.com/MyBlog.naver"}
            target="_blank"
            rel="noreferrer"
            title="내 네이버 블로그를 새 탭으로 엽니다"
          >
            네이버 블로그 ↗
          </a>
          {s?.tistoryBlog && (
            <a className="btn" href={`https://${s.tistoryBlog}.tistory.com/manage/newpost/`} target="_blank" rel="noreferrer" title="티스토리 글쓰기 화면 — 아래쪽 '임시저장' 옆 숫자를 누르면 저장된 글 목록이 열립니다">
              티스토리 글쓰기 ↗
            </a>
          )}
        </span>
        {isTs ? (
          <button className="btn" onClick={tistoryLogin} disabled={tsLoggingIn || !s?.tistoryBlog} title={!s?.tistoryBlog ? "설정에서 티스토리 주소를 먼저 넣어주세요" : ""}>
            {tsLoggingIn ? "로그인 창 열림…" : tsOk ? "티스토리 다시 로그인" : "티스토리 로그인"}
          </button>
        ) : (
          <button className="btn" onClick={login} disabled={loggingIn}>
            {loggingIn ? "로그인 창 열림…" : naverOk ? "네이버 다시 로그인" : "네이버 로그인"}
          </button>
        )}
        <button className="btn" onClick={() => setDrawer(true)}>
          설정
        </button>
      </header>

      <main className="wrap">
        <section className="meters" aria-label="계량기">
          <div className="meter" data-level={meterLevel(pubRatio)}>
            <div className="hint">오늘 발행</div>
            <div className="big num">
              {usage?.publishedToday ?? "–"} / {usage?.dailyLimit ?? "–"}편
            </div>
            <div className="bar">
              <span style={{ width: `${Math.min(100, pubRatio * 100)}%` }} />
            </div>
            <div className="sub">
              {usage && usage.publishedToday >= usage.dailyLimit
                ? "오늘 한도에 도달했습니다 — 설정에서 늘릴 수 있습니다"
                : `발행 사이 최소 ${usage?.minIntervalMin ?? "–"}분 간격`}
            </div>
          </div>
          <div className="meter" data-level={meterLevel(neuRatio)}>
            <div className="hint">이미지 생성량</div>
            <div className="big num">
              {usage ? Math.round(usage.neurons).toLocaleString() : "–"} / {usage ? usage.neuronsLimit.toLocaleString() : "–"} 뉴런
            </div>
            <div className="bar">
              <span style={{ width: `${Math.min(100, neuRatio * 100)}%` }} />
            </div>
            <div className="sub num">
              {usage ? (usage.neuronsMeasured ? "실측" : `추정치${usage.neuronsNote ? ` (${usage.neuronsNote})` : ""}`) : ""} · 장당{" "}
              {usage ? Math.round(usage.perImage) : "–"} 뉴런
            </div>
          </div>
        </section>

        <div className="stack">
          {status && !status.claude.ok && (
            <div className="panel err">AI 프로그램(claude)을 찾지 못했습니다. 설치와 로그인이 필요합니다. README의 "준비물"을 봐주세요.</div>
          )}
          {status && isTs && !tsOk && (
            <div className="panel">
              <b>{status.tistory.state === "no_blog" ? "티스토리 주소가 필요합니다." : "티스토리 로그인이 필요합니다."}</b>
              <p className="hint" style={{ margin: "6px 0 0" }}>
                {status.tistory.state === "no_blog" ? (
                  <>
                    오른쪽 위 <b>[설정]</b> → 맨 아래 <b>티스토리 주소</b>에 블로그 주소(예: myblog.tistory.com)를 넣어주세요.
                  </>
                ) : (
                  <>
                    {status.tistory.state === "none" ? "" : `${status.tistory.message} `}위쪽 <b>[티스토리 로그인]</b>을 눌러 새 창에서 카카오 계정으로 로그인해 주세요. <b>카카오 로그인 화면의 &quot;로그인 상태 유지&quot;를 체크</b>하면 오래 유지됩니다.
                  </>
                )}
                {loginMsg && <><br />{loginMsg}</>}
              </p>
            </div>
          )}
          {status && !isTs && !naverOk && (
            <div className="panel">
              <b>네이버 로그인이 필요합니다.</b>
              <p className="hint" style={{ margin: "6px 0 0" }}>
                {status.naver.message} 위쪽 <b>[네이버 로그인]</b>을 눌러 새 창에서 로그인해 주세요. <b>로그인할 때 &quot;로그인 상태 유지&quot;를 켜면 한 달간 유지됩니다.</b>
                {loginMsg && <><br />{loginMsg}</>}
              </p>
            </div>
          )}

          <section className="panel stack" aria-label="글 만들기">
            <h2>글 만들기</h2>
            <div>
              <div className="hint" style={{ marginBottom: 6 }}>올릴 곳</div>
              <div className="seg">
                <button type="button" aria-pressed={target === "naver"} onClick={() => setTarget("naver")}>네이버 블로그</button>
                <button type="button" aria-pressed={target === "tistory"} onClick={() => setTarget("tistory")}>티스토리 (임시저장까지만)</button>
              </div>
              {isTs && (
                <p className="hint">
                  티스토리는 글을 써서 <b>임시저장까지만</b> 합니다. 사장님이 읽고 고친 뒤 직접 발행하세요. 구글 검색에 맞는 정보형 문체로 씁니다.
                </p>
              )}
            </div>
            <div>
              <div className="hint" style={{ marginBottom: 6 }}>카테고리</div>
              <div className="cards">
                {CATS.map((c) => (
                  <button key={c.id} type="button" className="card" aria-pressed={category === c.id} onClick={() => pickCategory(c.id)}>
                    <b>{c.name}</b>
                    <span>{c.desc}</span>
                  </button>
                ))}
              </div>
              {isTs && (
                <p className="hint">
                  티스토리 글은 본문 1,500~2,000자, 제목에 검색 키워드를 넣고, 직접 이해한 것을 설명하듯 씁니다. AI 그림은 글마다 1~3장 그립니다.
                  {category && " 발행할 때 티스토리 카테고리도 같은 이름으로 골라 주세요."}
                </p>
              )}
            </div>
            <div className="hint" style={{ marginBottom: -6 }}>글 유형</div>
            <div className="cards">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="card"
                  aria-pressed={mode === m.id}
                  onClick={() => {
                    setMode(m.id);
                    if (m.id === "auto" && photoSource === "local") setPhotoSource("crawl");
                  }}
                >
                  <b>{m.name}</b>
                  <span>{m.desc}</span>
                </button>
              ))}
            </div>

            <label className="f">
              <span>{mode === "auto" ? "관심 키워드 (예: 제주도 여행, 홈카페)" : "주제 (예: 성수동 ○○카페 방문 후기)"}</span>
              <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} maxLength={200} />
            </label>
            {mode === "auto" && (
              <div className="stack">
                <div className="seg">
                  <button type="button" className="btn" disabled={!keyword.trim() || ideas.busy} onClick={suggest} style={{ marginLeft: "auto" }}>
                    {ideas.busy ? "제목 찾는 중… (1~2분)" : "제목 추천 받기"}
                  </button>
                </div>
                {ideas.err && <p className="err">{ideas.err}</p>}
                {ideas.list.length > 0 && ideas.forKey === `${keyword}|${target}|${category}` && (
                  <div>
                    <div className="hint" style={{ marginBottom: 6 }}>
                      쓰고 싶은 제목을 하나 고르세요. 고르지 않으면 1번으로 씁니다.
                    </div>
                    <div className="stack" style={{ gap: 6 }}>
                      {ideas.list.map((it, i) => (
                        <button key={i} type="button" className="card" aria-pressed={pickedIdea === i} onClick={() => setPickedIdea(pickedIdea === i ? null : i)}>
                          <b>
                            {i + 1}. {it.title}
                          </b>
                          <span>{it.angle}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {mode !== "auto" && (
              <label className="f">
                <span>
                  핵심 내용 {mode === "branding" ? "— 숫자·실적은 여기 적은 것만 씁니다" : "— 가격·메뉴·위치 등 꼭 들어갈 내용"}
                </span>
                <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={5000} />
              </label>
            )}

            <div>
              <div className="hint" style={{ marginBottom: 6 }}>사진</div>
              <div className="seg">
                {PHOTO.filter((p) => !(mode === "auto" && p.id === "local")).map((p) => (
                  <button key={p.id} type="button" aria-pressed={photoSource === p.id} onClick={() => setPhotoSource(p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
              {photoSource === "crawl" && (
                <p className="hint">
                  워터마크·사람 얼굴이 보이는 사진은 AI가 걸러냅니다. 그래도 저작권을 보장하지는 않습니다.
                  {isTs && " 애드센스 블로그에는 내 사진이나 AI가 그린 사진을 권합니다."}
                </p>
              )}
              {isTs && photoSource !== "none" && (
                <p className="hint">티스토리에는 사진 자리에 노란 안내문이 들어갑니다. 사진 파일은 [사진 폴더 열기]로 열어 끌어다 넣으면 됩니다.</p>
              )}
              {photoSource === "ai" && (
                <div style={{ marginTop: 10 }}>
                  {cfMissing && <span className="badge">Cloudflare 열쇠가 없어 쓸 수 없습니다</span>}
                  <div className="seg" style={{ marginTop: 8 }}>
                    <button type="button" aria-pressed={imageStyle === "photo"} onClick={() => setImageStyle("photo")}>실사</button>
                    <button type="button" aria-pressed={imageStyle === "illust"} onClick={() => setImageStyle("illust")}>일러스트</button>
                  </div>
                  <p className="hint">계기판·눈금처럼 글자가 들어가는 사물은 일러스트가 더 잘 나옵니다.</p>
                </div>
              )}
              {photoSource === "local" && (
                <div style={{ marginTop: 10 }} className="stack">
                  <div className="row">
                    <input type="text" placeholder="사진 폴더 경로 (직접 입력해도 됩니다)" value={photoFolder} onChange={(e) => setPhotoFolder(e.target.value)} />
                    <button type="button" className="btn" onClick={pickFolder}>폴더 고르기</button>
                  </div>
                  <div className="seg">
                    <button type="button" aria-pressed={placement === "ai"} onClick={() => setPlacement("ai")}>내용에 맞춰 배치</button>
                    <button type="button" aria-pressed={placement === "order"} onClick={() => setPlacement("order")}>파일 순서대로</button>
                  </div>
                </div>
              )}
            </div>

            {s && (
              <div className="target" data-sig={sig}>
                {s.killSwitch
                  ? "전체 중단 중 — 발행되지 않습니다"
                  : s.dryRun
                    ? isTs
                      ? "연습 모드 — 티스토리에 저장하지 않습니다"
                      : "연습 모드 — 블로그에 올라가지 않습니다"
                    : isTs
                      ? `티스토리(${s.tistoryBlog || "주소 없음"}) — 임시저장까지만 합니다. 발행은 직접 하세요`
                      : `실제 발행 — ${VISIBILITY_LABEL[s.visibility]}로 올라갑니다`}
              </div>
            )}
            {formErr && <p className="err">{formErr}</p>}
            {anyActive && <p className="hint">진행 중인 작업이 끝나면 새로 만들 수 있습니다.</p>}
            <button type="button" className="go" data-sig={isTs && s && !s.killSwitch ? "safe" : sig} disabled={!canRun} onClick={start}>
              {starting ? "시작하는 중…" : s?.killSwitch ? "전체 중단 중" : goLabel}
            </button>
            <p className="hint">
              자동 발행은 네이버 이용약관상 계정 제재 위험이 있습니다. 그래서 연습 모드가 기본이고, 하루 발행 수·간격 브레이크가 있습니다.
            </p>
          </section>

          {detail && selected === detail.job.id && (
            <section className="panel stack" aria-label="진행과 결과">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <h2 style={{ margin: 0 }}>
                  #{detail.job.id} {detail.job.keyword} — {STATUS_LABEL[jobs.find((j) => j.id === selected)?.status ?? detail.job.status]}
                  {jobs.find((j) => j.id === selected)?.stage ? ` · ${jobs.find((j) => j.id === selected)?.stage}` : ""}
                </h2>
                {!ACTIVE.includes(jobs.find((j) => j.id === selected)?.status ?? detail.job.status) && (
                  <button type="button" className="btn" onClick={() => deleteJob(detail.job.id)} title="앱의 기록만 지웁니다(블로그 글은 그대로)">
                    🗑 삭제
                  </button>
                )}
              </div>
              {(() => {
                // 🔧 실패했을 때 조치 방법
                const curStatus = jobs.find((j) => j.id === selected)?.status ?? detail.job.status;
                if (ACTIVE.includes(curStatus)) return null;
                const ps = detail.post?.status;
                const failed = curStatus === "failed" || ps === "failed" || ps === "blocked" || ps === "draft_unverified";
                if (!failed) return null;
                let target: "naver" | "tistory" = "naver";
                try {
                  target = JSON.parse(detail.job.inputs || "{}").target === "tistory" ? "tistory" : "naver";
                } catch {}
                const g = diagnoseFailure(`${detail.post?.note ?? ""} ${detail.job.error ?? ""}`, { target, hasDraft: Boolean(detail.draft) });
                return (
                  <div className="fixbox">
                    <b>🔧 해결 방법 — {g.title}</b>
                    <ol>
                      {g.steps.map((st) => (
                        <li key={st}>{st}</li>
                      ))}
                    </ol>
                    {g.actions.length > 0 && (
                      <div className="row" style={{ flexWrap: "wrap" }}>
                        {g.actions.map((a) => (
                          <button key={a} type="button" className={a === "retry" || a === "remake" ? "btn primary" : "btn"} onClick={() => runFix(a, detail)}>
                            {FIX_LABEL[a]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="logs" ref={logBox}>
                {liveLogs.map((l) => (
                  <div key={l.id} className={l.level}>
                    {l.message}
                  </div>
                ))}
                {!liveLogs.length && <div className="hint">기록이 아직 없습니다</div>}
              </div>

              {detail.post && (
                <div className="stack">
                  <div>
                    <b>{POST_LABEL[detail.post.status] ?? detail.post.status}</b> — {detail.post.note}
                  </div>
                  {(detail.post.status === "draft_saved" || detail.post.status === "draft_unverified") && s?.tistoryBlog && (
                    <div className="hint">
                      <a href={`https://${s.tistoryBlog}.tistory.com/manage/newpost/`} target="_blank" rel="noreferrer">
                        티스토리 글쓰기 화면 열기 ↗
                      </a>{" "}
                      — 아래쪽 <b>임시저장</b> 옆 숫자를 누르면 이 글을 불러올 수 있습니다.
                    </div>
                  )}
                  {detail.images.some((i) => i.verdict_ok) && (
                    <div>
                      <button className="btn" onClick={() => openPhotoFolder(detail.job.id)}>
                        사진 폴더 열기
                      </button>
                    </div>
                  )}
                  {detail.post.blog_url && (
                    <div>
                      올라간 글:{" "}
                      <a href={detail.post.blog_url} target="_blank" rel="noreferrer">
                        {detail.post.blog_url}
                      </a>
                    </div>
                  )}
                  {detail.post.screenshot && (
                    <details open={detail.post.status === "dry_run"}>
                      <summary>완성 화면 보기</summary>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="shot" src={fileUrl(detail.post.screenshot)} alt="글쓰기 화면 스크린샷" />
                    </details>
                  )}
                </div>
              )}

              {detail.draft && (
                <details open>
                  <summary>글 미리보기{detail.draft.category ? ` — 카테고리: ${detail.draft.category}` : ""}</summary>
                  <CopyButton d={detail.draft} images={detail.images} />
                  {(detail.draft.tags ?? []).length > 0 && (
                    <p className="hint" style={{ margin: "0 0 8px" }}>
                      태그: {(detail.draft.tags ?? []).map((t) => "#" + t).join(" ")}
                    </p>
                  )}
                  <Preview
                    d={detail.draft}
                    images={detail.images}
                    headingAsQuote={detail.job.mode !== "auto" && (() => { try { return JSON.parse(detail.job.inputs || "{}").target !== "tistory"; } catch { return true; } })()}
                  />
                </details>
              )}

              {detail.ideas.length > 0 && (
                <details>
                  <summary>글감 {detail.ideas.length}개</summary>
                  <ol>
                    {detail.ideas.map((i) => (
                      <li key={i.id}>
                        {i.chosen ? <b>{i.title} (선택)</b> : i.title} <span className="hint">— {i.angle}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {detail.sources.length > 0 && (
                <details>
                  <summary>모은 자료 {detail.sources.length}건</summary>
                  <ul>
                    {detail.sources.map((s2) => (
                      <li key={s2.id}>
                        [{s2.type === "news" ? "뉴스" : "블로그"}]{" "}
                        <a href={s2.url} target="_blank" rel="noreferrer">
                          {s2.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {detail.images.some((i) => !i.verdict_ok) && (
                <details>
                  <summary>탈락한 사진 {detail.images.filter((i) => !i.verdict_ok).length}장 (걸러진 이유)</summary>
                  <div className="rej">
                    {detail.images
                      .filter((i) => !i.verdict_ok)
                      .map((i) => (
                        <figure key={i.id}>
                          {i.local_path && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={fileUrl(i.local_path)} alt="" />
                          )}
                          <figcaption>{i.verdict_reason}</figcaption>
                        </figure>
                      ))}
                  </div>
                </details>
              )}
              {detail.job.error && <p className="err">{detail.job.error}</p>}
            </section>
          )}
        </div>

        <aside className="panel" aria-label="최근 작업">
          <h2>최근 작업</h2>
          {!jobs.length && <p className="hint">아직 만든 글이 없습니다.</p>}
          <ul className="jobs">
            {jobs.map((j) => (
              <li key={j.id}>
                <button type="button" aria-pressed={selected === j.id} onClick={() => setSelected(j.id)}>
                  <span>
                    #{j.id} {j.keyword}
                  </span>
                  <span className="st" data-s={statusSig(j)}>
                    {ACTIVE.includes(j.status)
                      ? j.stage || STATUS_LABEL[j.status]
                      : j.post_status
                        ? POST_LABEL[j.post_status]
                        : STATUS_LABEL[j.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </main>

      {status && (
        <SettingsDrawer
          open={drawer}
          onClose={() => setDrawer(false)}
          settings={status.settings}
          limits={status.limits}
          tistoryMessage={status.tistory.message}
          dataRoot={status.dataRoot}
          onChange={(ns) => {
            setStatus({ ...status, settings: ns });
            loadUsage();
          }}
        />
      )}
    </>
  );
}
