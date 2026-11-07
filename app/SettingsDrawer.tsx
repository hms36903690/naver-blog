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
}) {
  const { settings: s, limits } = props;
  const [err, setErr] = useState("");

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

        <p style={{ marginTop: 24 }}>
          <button className="btn" onClick={() => confirm("모든 설정을 처음 값으로 되돌릴까요?") && save({ reset: true })}>
            기본값으로 되돌리기
          </button>
        </p>
      </aside>
    </>
  );
}
