import { config } from "@/config";
import { getDb, transaction } from "./db";

import { VISIBILITIES, VISIBILITY_LABEL, type Visibility } from "./labels";
export { VISIBILITIES, VISIBILITY_LABEL, type Visibility };

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
  /** 티스토리 블로그 이름(예: myblog → myblog.tistory.com). 비어 있으면 티스토리 기능을 못 쓴다. */
  tistoryBlog: string;
  /** 사장님 티스토리 최근 글에서 배운 글투 안내(앱이 만들고 사람이 고칠 수 있다). 티스토리 글에만 쓴다. */
  tistoryStyle: string;
};

/** 숫자 설정의 범위. API 로 내려보내 UI 가 같은 규칙을 쓴다. */
export const LIMITS = {
  dailyPublishLimit: { min: 1, max: 50 },
  minPublishIntervalMin: { min: 0, max: 720 },
  scrapeTopN: { min: 3, max: 30 },
  imageCandidates: { min: 3, max: 20 },
  cfImageSteps: { min: 1, max: 8 },
  claudeTimeoutSec: { min: 30, max: 900 },
  claudeConcurrency: { min: 1, max: 6 },
} as const;

const BOOL_KEYS = ["dryRun", "killSwitch", "showBrowser"] as const;

/** "https://myblog.tistory.com/manage" 처럼 넣어도 "myblog" 로 정리. 형식이 틀리면 null. */
export function normalizeTistoryBlog(v: string): string | null {
  let x = String(v ?? "").trim().toLowerCase();
  if (!x) return "";
  x = x.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.tistory\.com$/, "");
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(x) ? x : null;
}
type NumKey = keyof typeof LIMITS;
const NUM_KEYS = Object.keys(LIMITS) as NumKey[];

export function defaultSettings(): Settings {
  const d = config.defaults;
  return {
    ...d,
    // ⚠️ 공개 범위 기본값은 반드시 비공개. 네이버 발행 레이어의 기본값은 전체공개다(7-19).
    visibility: VISIBILITIES.includes(d.visibility) ? d.visibility : "private",
  } as Settings;
}

const clamp = (k: NumKey, v: number) => {
  const { min, max } = LIMITS[k];
  return Math.min(max, Math.max(min, Math.round(v)));
};

export function getSettings(): Settings {
  const s = defaultSettings();
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  for (const { key, value } of rows) {
    if ((BOOL_KEYS as readonly string[]).includes(key)) (s as Record<string, unknown>)[key] = value === "true";
    else if ((NUM_KEYS as string[]).includes(key)) {
      const n = Number(value);
      if (Number.isFinite(n)) (s as Record<string, unknown>)[key] = clamp(key as NumKey, n);
    } else if (key === "visibility" && (VISIBILITIES as string[]).includes(value)) s.visibility = value as Visibility;
    else if (key === "tistoryBlog") s.tistoryBlog = value;
    else if (key === "tistoryStyle") s.tistoryStyle = value;
  }
  return s;
}

export class UnknownSettingError extends Error {}

/** 범위를 벗어난 값은 서버가 잘라낸다(클램프). 알 수 없는 키는 거절. */
export function updateSettings(patch: Record<string, unknown>): Settings {
  const db = getDb();
  const up = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if ((BOOL_KEYS as readonly string[]).includes(k)) up.run(k, String(v === true || v === "true"));
      else if ((NUM_KEYS as string[]).includes(k)) {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new UnknownSettingError(`숫자가 아닙니다: ${k}`);
        up.run(k, String(clamp(k as NumKey, n)));
      } else if (k === "tistoryStyle") {
        up.run(k, String(v ?? "").slice(0, 4000));
      } else if (k === "tistoryBlog") {
        const b = normalizeTistoryBlog(String(v));
        if (b === null) throw new UnknownSettingError("티스토리 주소 형식이 맞지 않습니다 (예: myblog 또는 myblog.tistory.com)");
        up.run(k, b);
      } else if (k === "visibility") {
        if (!(VISIBILITIES as unknown[]).includes(v)) throw new UnknownSettingError(`알 수 없는 공개 범위: ${String(v)}`);
        up.run(k, String(v));
      } else throw new UnknownSettingError(`알 수 없는 설정: ${k}`);
    }
  });
  return getSettings();
}

/** settings 테이블을 비우면 전부 기본값으로 돌아간다. */
export function resetSettings(): Settings {
  getDb().prepare("DELETE FROM settings").run();
  return getSettings();
}
