import fs from "node:fs";
import type { BrowserContext } from "playwright";

/**
 * 로그인 정보(storageState) 갱신 저장.
 * ⚠️ 원인(티스토리 로그인이 계속 풀림): 예전에는 로그인할 때 한 번만 저장하고, 이후 사용할 때 사이트가 연장해 준
 *   쿠키를 버렸다. 평소 브라우저는 연장된 쿠키를 계속 저장하므로 오래 유지되지만, 앱은 처음 받은 쿠키만 재사용해
 *   그 만료 시각에 풀렸다. → "아직 로그인된 상태를 확인한 직후"에만 새 쿠키로 덮어쓴다(풀린 상태로 덮어쓰지 않도록).
 * 쓰는 도중 끊겨 파일이 깨지지 않도록 임시 파일에 쓴 뒤 바꿔치기한다.
 */
export async function refreshSessionFile(context: BrowserContext, file: string): Promise<void> {
  try {
    const tmp = `${file}.tmp`;
    await context.storageState({ path: tmp });
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error("[session] 로그인 정보 갱신 실패:", (e as Error).message);
  }
}

export type CookieSummary = {
  exists: boolean;
  /** 가장 늦게까지 유지되는 로그인 쿠키의 만료 시각(없으면 null) */
  until: string | null;
  /** 브라우저를 닫으면 사라지는 쿠키만 있으면 true — "로그인 상태 유지"가 꺼졌을 가능성 */
  sessionOnly: boolean;
  names: string[];
};

/** 저장된 로그인 정보에서 쿠키 이름과 만료 시각만 본다(값은 읽지 않는다). */
export function summarizeSessionFile(file: string, domainRe: RegExp, keyNames: string[]): CookieSummary {
  if (!fs.existsSync(file)) return { exists: false, until: null, sessionOnly: false, names: [] };
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { cookies?: Array<{ name: string; domain: string; expires: number }> };
    const cs = (j.cookies ?? []).filter((c) => domainRe.test(c.domain));
    const keys = cs.filter((c) => keyNames.includes(c.name));
    const pool = keys.length ? keys : cs;
    const persistent = pool.filter((c) => c.expires > 0);
    const max = persistent.length ? Math.max(...persistent.map((c) => c.expires)) : 0;
    return {
      exists: true,
      until: max ? new Date(max * 1000).toISOString() : null,
      sessionOnly: pool.length > 0 && persistent.length === 0,
      names: [...new Set(cs.map((c) => c.name))].slice(0, 30),
    };
  } catch {
    return { exists: true, until: null, sessionOnly: false, names: [] };
  }
}

export const fmtUntil = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

