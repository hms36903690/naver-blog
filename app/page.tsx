"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  draft: { title: string; sections: Section[] } | null;
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
    const r = await fetch("/api/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keyword, target }) });
    const j = await r.json();
    if (!r.ok) return setIdeas({ busy: false, list: [], sources: [], err: j.error || "추천 실패" });
    setIdeas({ busy: false, list: j.ideas, sources: j.sources, forKey: `${keyword}|${target}` });
  }
  const [keyword, setKeyword] = useState("");
  const [details, setDetails] = useState("");
  // 처음 켤 때 기본값은 "AI가 그리기"(저작권 걱정 없음). Cloudflare 열쇠가 없으면 아래에서 "사진 없음"으로 바꾼다.
  const [photoSource, setPhotoSource] = useState<PhotoSource>("ai");
  const [imageStyle, setImageStyle] = useState<"photo" | "illust">("photo");
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
  }, [selected, loadDetail, loadJobs, loadUsage]);

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
          // 추천 목록이 있으면 고른 것(안 골랐으면 화면에 보인 1번)을 그대로 쓴다 — 다시 추천받지 않는다
          ...(mode === "auto" && ideas.list.length && ideas.forKey === `${keyword}|${target}`
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
                  {["건강", "금융", "재테크", "생활경제"].map((k) => (
                    <button key={k} type="button" aria-pressed={keyword === k} onClick={() => setKeyword(k)}>
                      {k}
                    </button>
                  ))}
                  <button type="button" className="btn" disabled={!keyword.trim() || ideas.busy} onClick={suggest} style={{ marginLeft: "auto" }}>
                    {ideas.busy ? "제목 찾는 중… (1~2분)" : "제목 추천 받기"}
                  </button>
                </div>
                {ideas.err && <p className="err">{ideas.err}</p>}
                {ideas.list.length > 0 && ideas.forKey === `${keyword}|${target}` && (
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
              <h2>
                #{detail.job.id} {detail.job.keyword} — {STATUS_LABEL[jobs.find((j) => j.id === selected)?.status ?? detail.job.status]}
                {jobs.find((j) => j.id === selected)?.stage ? ` · ${jobs.find((j) => j.id === selected)?.stage}` : ""}
              </h2>
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
                  <summary>글 미리보기</summary>
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
          onChange={(ns) => {
            setStatus({ ...status, settings: ns });
            loadUsage();
          }}
        />
      )}
    </>
  );
}
