"use client";

import { useEffect, useState } from "react";
import { FREE_DAILY_NEURONS, imagesPerDay, neuronsPerImage } from "@/lib/ai/neurons";
import { VISIBILITIES, VISIBILITY_LABEL, type Visibility } from "@/lib/labels";

export type Settings = {
  dryRun: boolean;
  killSwitch: boolean;
  visibility: Visibility;
  dailyPublishLimit: number;
  minPublishIntervalMin: number;
  scrapeTopN: number;
  imageCandidates: number;
  cfImageSteps: number;
  showBrowser: boolean;
  claudeTimeoutSec: number;
  claudeConcurrency: number;
  tistoryBlog: string;
  tistoryStyle: string;
  tistoryWeeklyLimit: number;
  naverCtaText: string;
  naverCtaUrl: string;
  naverAuthorBio: string;
  complianceMode: boolean;
  complianceNotice: string;
};
export type Limits = Record<string, { min: number; max: number }>;

function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; color?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      className="switch"
      style={props.color ? ({ "--sw": props.color } as React.CSSProperties) : undefined}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}

function Num(props: { k: keyof Settings; s: Settings; limits: Limits; save: (p: Partial<Settings>) => void; unit?: string }) {
  const lim = props.limits[props.k as string];
  const [v, setV] = useState(String(props.s[props.k]));
  useEffect(() => setV(String(props.s[props.k])), [props.s, props.k]);
  // 입력 중에는 자유롭게 두고, 저장할 때 서버가 범위를 잘라낸다(클램프)
  return (
    <span className="row" style={{ flex: "none" }}>
      <input
        type="number"
        className="num"
        value={v}
        min={lim?.min}
        max={lim?.max}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== "" && props.save({ [props.k]: Number(v) } as Partial<Settings>)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {props.unit && <small className="hint">{props.unit}</small>}
    </span>
  );
}

export default function SettingsDrawer(props: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  limits: Limits;
  onChange: (s: Settings) => void;
  tistoryMessage?: string;
  dataRoot?: string;
}) {
  const { settings: s, limits } = props;
  const [err, setErr] = useState("");
  const [blog, setBlog] = useState(s.tistoryBlog);
  useEffect(() => setBlog(s.tistoryBlog), [s.tistoryBlog]);
  const [ctaText, setCtaText] = useState(s.naverCtaText);
  const [ctaUrl, setCtaUrl] = useState(s.naverCtaUrl);
  useEffect(() => {
    setCtaText(s.naverCtaText);
    setCtaUrl(s.naverCtaUrl);
  }, [s.naverCtaText, s.naverCtaUrl]);
  const [notice, setNotice] = useState(s.complianceNotice);
  useEffect(() => setNotice(s.complianceNotice), [s.complianceNotice]);
  const [bio, setBio] = useState(s.naverAuthorBio);
  useEffect(() => setBio(s.naverAuthorBio), [s.naverAuthorBio]);
  const [style, setStyle] = useState(s.tistoryStyle);
  useEffect(() => setStyle(s.tistoryStyle), [s.tistoryStyle]);
  const [learning, setLearning] = useState<{ busy: boolean; msg?: string; err?: string }>({ busy: false });
  async function learnStyle() {
    setLearning({ busy: true });
    const r = await fetch("/api/tistory/style", { method: "POST" });
    const j = await r.json();
    if (!r.ok) return setLearning({ busy: false, err: j.error || "실패" });
    props.onChange(j.settings);
    setLearning({ busy: false, msg: `최근 글 ${j.posts}편을 읽고 글투를 배웠습니다. 아래 내용은 직접 고쳐도 됩니다.` });
  }
  const [ndiag, setNdiag] = useState<{ busy: boolean; summary?: string[]; detail?: unknown; error?: string }>({ busy: false });
  async function diagnoseNaver() {
    if (!confirm("네이버 글쓰기 화면을 열어 버튼들을 재 봅니다(1~2분).\n\n• 발행하지 않고, 글자도 넣지 않습니다.\n• 시험용 작은 사진 1장을 넣어 보므로, 네이버 '임시저장' 목록에 빈 글이 남을 수 있습니다(지워도 됩니다).\n• 네이버에서 직접 쓰다 만 글이 있으면 먼저 저장해 두세요.\n\n시작할까요?")) return;
    setNdiag({ busy: true });
    const r = await fetch("/api/naver/diagnose", { method: "POST" });
    const j = await r.json();
    setNdiag(r.ok ? { busy: false, summary: j.summary, detail: j.detail } : { busy: false, error: j.error || "점검 실패" });
  }
  const [diag, setDiag] = useState<{ busy: boolean; summary?: string[]; detail?: unknown; error?: string }>({ busy: false });
  async function diagnose() {
    setDiag({ busy: true });
    const r = await fetch("/api/tistory/diagnose", { method: "POST" });
    const j = await r.json();
    setDiag(r.ok ? { busy: false, summary: j.summary, detail: j.detail } : { busy: false, error: j.error || "점검 실패" });
  }

  useEffect(() => {
    if (!props.open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [props.open, props.onClose]);

  async function save(patch: Partial<Settings> | { reset: true }) {
    setErr("");
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const j = await r.json();
    if (!r.ok) return setErr(j.error || "저장 실패");
    props.onChange(j.settings);
  }

  if (!props.open) return null;
  const per = neuronsPerImage(s.cfImageSteps);
  const range = (k: string) => (limits[k] ? `${limits[k].min}~${limits[k].max}` : "");

  return (
    <>
      <div className="scrim" onClick={props.onClose} />
      <aside className="drawer" role="dialog" aria-label="설정">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>설정</b>
          <button className="btn" onClick={props.onClose}>닫기 (Esc)</button>
        </div>
        <p className="hint">바꾸면 바로 저장됩니다.</p>
        {err && <p className="err">{err}</p>}

        <h3>발행 안전장치</h3>
        <div className="set">
          <div>
            연습 모드
            <small>켜져 있으면 실제로 올리지 않고 완성 화면만 저장합니다</small>
          </div>
          <Switch label="연습 모드" checked={s.dryRun} color="var(--safe)" onChange={(v) => save({ dryRun: v })} />
        </div>
        <div className="set">
          <div>
            전체 중단
            <small>켜면 어떤 작업도 발행되지 않습니다</small>
          </div>
          <Switch label="전체 중단" checked={s.killSwitch} color="var(--armed)" onChange={(v) => save({ killSwitch: v })} />
        </div>
        <div className="set" style={{ display: "block" }}>
          <div style={{ marginBottom: 6 }}>
            공개 범위
            <small>처음에는 비공개로 올려 보시길 권합니다</small>
          </div>
          <div className="seg">
            {VISIBILITIES.map((v) => (
              <button key={v} type="button" aria-pressed={s.visibility === v} onClick={() => save({ visibility: v })}>
                {VISIBILITY_LABEL[v]}
                {v === "private" ? " (기본값)" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="set">
          <div>
            하루 발행 수<small>이 앱의 자체 브레이크입니다 ({range("dailyPublishLimit")}편)</small>
          </div>
          <Num k="dailyPublishLimit" s={s} limits={limits} save={save} unit="편" />
        </div>
        <div className="set">
          <div>
            최소 발행 간격<small>{range("minPublishIntervalMin")}분</small>
          </div>
          <Num k="minPublishIntervalMin" s={s} limits={limits} save={save} unit="분" />
        </div>

        <h3>글감과 사진</h3>
        <div className="set">
          <div>
            검색 수집량<small>뉴스·블로그 각각 몇 건까지 ({range("scrapeTopN")})</small>
          </div>
          <Num k="scrapeTopN" s={s} limits={limits} save={save} unit="건" />
        </div>
        <div className="set">
          <div>
            사진 후보 수
            <small>검색 사진 한 자리당 몇 장까지 살펴볼지. 낮추면 빈 자리가 늘고, 높이면 AI 사용량이 늘어납니다 (권장 10 이상)</small>
          </div>
          <Num k="imageCandidates" s={s} limits={limits} save={save} unit="장" />
        </div>
        <div className="set">
          <div>
            AI 사진 품질(스텝)
            <small className="num">
              지금은 장당 {Math.round(per)} 뉴런 — 무료 한도({FREE_DAILY_NEURONS.toLocaleString()})로 하루 {imagesPerDay(s.cfImageSteps)}장
            </small>
          </div>
          <Num k="cfImageSteps" s={s} limits={limits} save={save} />
        </div>

        <h3>실행 방식</h3>
        <div className="set">
          <div>
            브라우저 보기<small>작업하는 브라우저 창을 화면에 띄웁니다</small>
          </div>
          <Switch label="브라우저 보기" checked={s.showBrowser} onChange={(v) => save({ showBrowser: v })} />
        </div>
        <div className="set">
          <div>
            AI 동시 실행<small>컴퓨터가 느려지면 줄이세요 ({range("claudeConcurrency")})</small>
          </div>
          <Num k="claudeConcurrency" s={s} limits={limits} save={save} unit="개" />
        </div>
        <div className="set">
          <div>
            AI 응답 대기<small>{range("claudeTimeoutSec")}초</small>
          </div>
          <Num k="claudeTimeoutSec" s={s} limits={limits} save={save} unit="초" />
        </div>

        <h3>보험 광고 규정 (보험설계사)</h3>
        <div className="set">
          <div>
            보험 광고 안전장치
            <small>네이버 블로그에만 적용됩니다(티스토리는 정보성이라 제외). AI가 보험 상품명·보험사·보장·가입 권유를 쓰지 않고, 글을 다 쓴 뒤 문제 표현을 한 번 더 검사합니다. 켜져 있으면 심의필 문구가 없거나 문제 표현이 있을 때 네이버에 실제 발행하지 않습니다.</small>
          </div>
          <Switch label="보험 광고 안전장치" checked={s.complianceMode} color="var(--safe)" onChange={(v) => save({ complianceMode: v })} />
        </div>
        <div className="set" style={{ display: "block" }}>
          <div style={{ marginBottom: 6 }}>
            심의필 번호·필수 안내 문구
            <small>소속 회사(GA·보험사) 준법감시 심의에서 받은 문구를 그대로 넣으세요. 네이버 글 끝에 붙습니다. 비어 있으면 네이버 실제 발행을 막습니다(연습 모드·티스토리 임시저장은 됨).</small>
          </div>
          <textarea
            style={{ minHeight: 80 }}
            value={notice}
            maxLength={500}
            placeholder="예) ○○보험협회 심의필 제0000-000호 (2026.12.01~2027.11.30)"
            onChange={(e) => setNotice(e.target.value)}
            onBlur={() => notice !== s.complianceNotice && save({ complianceNotice: notice })}
          />
        </div>

        <h3>네이버 화면 점검</h3>
        <div className="set" style={{ display: "block" }}>
          <div style={{ marginBottom: 6 }}>
            네이버 글쓰기 화면 점검
            <small>네이버 로그인 뒤, 실제 발행 전에 한 번 눌러 주세요. 제목·본문·소제목·형광펜·사진·발행 버튼·공개 범위를 앱이 찾는지 재기만 합니다(발행 안 함). 결과를 캡처해 보내주시면 됩니다.</small>
          </div>
          <button className="btn" disabled={ndiag.busy} onClick={diagnoseNaver}>
            {ndiag.busy ? "점검 중… (1~2분)" : "네이버 화면 점검"}
          </button>
          {ndiag.error && <p className="err">{ndiag.error}</p>}
          {ndiag.summary && (
            <div style={{ marginTop: 8 }}>
              {ndiag.summary.map((l) => (
                <div key={l} className="hint">{l}</div>
              ))}
              <details>
                <summary className="hint">자세한 결과(복사해서 보내기)</summary>
                <textarea readOnly style={{ minHeight: 160, fontSize: 11 }} value={JSON.stringify(ndiag.detail, null, 1)} />
              </details>
            </div>
          )}
        </div>

        <h3>네이버 글쓴이</h3>
        <div className="set" style={{ display: "block" }}>
          <div style={{ marginBottom: 6 }}>
            내 소개 (실제 경력·자격만)
            <small>예: "개인사업자 세무·노무 상담 10년, ○○ 자격". 네이버 글에 한 번 자연스럽게 들어갑니다. 비워 두면 경력 언급 없이 전문가 관점으로만 씁니다. AI는 여기 적힌 것 외의 경력을 지어내지 않습니다.</small>
          </div>
          <textarea style={{ minHeight: 70 }} value={bio} maxLength={300} onChange={(e) => setBio(e.target.value)} onBlur={() => bio !== s.naverAuthorBio && save({ naverAuthorBio: bio })} />
        </div>

        <h3>네이버 상담 신청 (인바운드)</h3>
        <div className="set" style={{ display: "block" }}>
          <div style={{ marginBottom: 6 }}>
            신청서 주소 (네이버 폼)
            <small>넣으면 모든 네이버 글 끝에 아래 안내와 신청서 주소가 붙습니다. 비우면 붙이지 않습니다.</small>
          </div>
          <input
            type="text"
            value={ctaUrl}
            placeholder="https://form.naver.com/response/..."
            onChange={(e) => setCtaUrl(e.target.value)}
            onBlur={() => ctaUrl !== s.naverCtaUrl && save({ naverCtaUrl: ctaUrl })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
        <div className="set" style={{ display: "block" }}>
          <div style={{ marginBottom: 6 }}>
            안내 문구
            <small>짧고 담백하게(글당 1개). 세무 대리·상담료는 세무사만 할 수 있어 "정보 정리 + 전문가 연결"로 적어 두었습니다.</small>
          </div>
          <textarea
            style={{ minHeight: 90 }}
            value={ctaText}
            maxLength={300}
            onChange={(e) => setCtaText(e.target.value)}
            onBlur={() => ctaText !== s.naverCtaText && save({ naverCtaText: ctaText })}
          />
        </div>

        <h3>티스토리 (임시저장까지만)</h3>
        <div className="set" style={{ display: "block" }}>
          <div style={{ marginBottom: 6 }}>
            티스토리 주소
            <small>예: myblog 또는 myblog.tistory.com — 이 앱은 티스토리에 발행하지 않고 임시저장까지만 합니다</small>
          </div>
          <input
            type="text"
            value={blog}
            placeholder="myblog.tistory.com"
            onChange={(e) => setBlog(e.target.value)}
            onBlur={() => blog !== s.tistoryBlog && save({ tistoryBlog: blog })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          {props.tistoryMessage && <p className="hint" style={{ margin: "6px 0 0" }}>{props.tistoryMessage}</p>}
        </div>
        <div className="set">
          <div>
            일주일 글 수<small>이번 주(월~일) 티스토리에 임시저장할 글 수 — 월·수·금처럼 나눠 발행하세요 ({range("tistoryWeeklyLimit")}편)</small>
          </div>
          <Num k="tistoryWeeklyLimit" s={s} limits={limits} save={save} unit="편" />
        </div>
        <div className="set" style={{ display: "block" }}>
          <div style={{ marginBottom: 6 }}>
            내 블로그 글투
            <small>내 티스토리 최근 글을 읽고 말투·구성·분량을 배워, 새 글을 그 스타일로 씁니다(문장을 베끼지는 않습니다). 로그인 없이 됩니다.</small>
          </div>
          <button className="btn" disabled={learning.busy || !s.tistoryBlog} onClick={learnStyle}>
            {learning.busy ? "읽고 배우는 중… (1~2분)" : s.tistoryStyle ? "다시 배우기" : "내 블로그 글투 배우기"}
          </button>
          {learning.err && <p className="err">{learning.err}</p>}
          {learning.msg && <p className="hint">{learning.msg}</p>}
          {(s.tistoryStyle || style) && (
            <textarea
              style={{ marginTop: 8, minHeight: 180, fontSize: 12 }}
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              onBlur={() => style !== s.tistoryStyle && save({ tistoryStyle: style })}
            />
          )}
        </div>
        <div className="set" style={{ display: "block" }}>
          <div style={{ marginBottom: 6 }}>
            티스토리 화면 점검
            <small>로그인한 뒤 눌러주세요. 글쓰기 화면을 열어 재기만 합니다(입력·저장 안 함). 결과를 캡처해 보내주시면 됩니다.</small>
          </div>
          <button className="btn" disabled={diag.busy || !s.tistoryBlog} onClick={diagnose}>
            {diag.busy ? "점검 중… (30초쯤)" : "티스토리 화면 점검"}
          </button>
          {diag.error && <p className="err">{diag.error}</p>}
          {diag.summary && (
            <div style={{ marginTop: 8 }}>
              {diag.summary.map((l) => (
                <div key={l} className="hint">{l}</div>
              ))}
              <details>
                <summary className="hint">자세한 결과(복사해서 보내기)</summary>
                <textarea readOnly style={{ minHeight: 160, fontSize: 11 }} value={JSON.stringify(diag.detail, null, 1)} />
              </details>
            </div>
          )}
        </div>

        {props.dataRoot && (
          <p className="hint" style={{ marginTop: 20 }}>
            내 정보(로그인·글·사진·열쇠) 저장 위치: <b>{props.dataRoot}</b>
            <br />
            새 버전을 받아 어디에 풀어도 이 정보를 그대로 씁니다. 이 폴더는 지우지 마세요.
          </p>
        )}
        <p style={{ marginTop: 24 }}>
          <button className="btn" onClick={() => confirm("모든 설정을 처음 값으로 되돌릴까요?") && save({ reset: true })}>
            기본값으로 되돌리기
          </button>
        </p>
      </aside>
    </>
  );
}
