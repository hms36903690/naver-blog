import { spawn } from "node:child_process";
import path from "node:path";
import type { z } from "zod";
import { config } from "@/config";
import { getSettings } from "./settings";

/**
 * AI 호출은 반드시 로컬 `claude -p` CLI 로 한다(구독요금제로 돌리기 위해, API 키 종량과금 X).
 * 프롬프트는 argv 가 아니라 stdin 으로 — 긴 한글이 argv escaping 에서 깨지기 때문.
 * 응답은 { type:"result", result:"...", is_error:false, ...필드 20여 개 } — .result 만 읽으면 된다.
 */

const isWin = process.platform === "win32";
const JSON_SYSTEM =
  "반드시 유효한 JSON 만 출력하라. 설명/마크다운/코드펜스 없이 JSON 객체 또는 배열만 반환하라.";

// ── 동시성 세마포어(한도는 호출 시점의 설정에서 읽는다) ─────────────
const g = globalThis as unknown as { __claudeSem?: { running: number; queue: Array<() => void> }; __claudeCalls?: number };
const sem = (g.__claudeSem ??= { running: 0, queue: [] });

async function acquire() {
  const limit = getSettings().claudeConcurrency;
  if (sem.running < limit) {
    sem.running++;
    return;
  }
  await new Promise<void>((res) => sem.queue.push(res));
  sem.running++;
}
function release() {
  sem.running--;
  const limit = getSettings().claudeConcurrency;
  while (sem.running < limit && sem.queue.length) sem.queue.shift()!();
}

/** 테스트·검증용: 이 프로세스에서 claude 를 몇 번 불렀는지. */
export const claudeCallCount = () => g.__claudeCalls ?? 0;

type RunResult = { ok: true; text: string } | { ok: false; error: string };

function spawnClaude(bin: string, input: string, timeoutMs: number, extra: { cwd?: string; args?: string[] } = {}): Promise<RunResult & { enoent?: boolean }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (r: RunResult & { enoent?: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    // 윈도우: npm 전역 바이너리는 claude.cmd 셸 심이라 shell:true 가 필요하다.
    // argv 에는 고정 플래그뿐이고 프롬프트는 stdin 이라 shell:true 여도 인용부호 문제가 없다.
    const p = spawn(bin, ["-p", "--output-format", "json", ...(extra.args ?? [])], { shell: isWin, windowsHide: true, cwd: extra.cwd });
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      done({ ok: false, error: `AI 응답 시간 초과(${Math.round(timeoutMs / 1000)}초)` });
    }, timeoutMs);
    // ⚠️ 한글은 UTF-8 로 3바이트다. Buffer 조각을 그대로 += 하면 조각 경계에서 글자가 깨진다(�).
    //   setEncoding 은 경계에 걸친 바이트를 다음 조각까지 기다렸다가 합쳐 준다.
    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");
    p.stdout.on("data", (d: string) => (stdout += d));
    p.stderr.on("data", (d: string) => (stderr += d));
    p.on("error", (e: NodeJS.ErrnoException) =>
      done({ ok: false, error: `claude 실행 실패: ${e.message}`, enoent: e.code === "ENOENT" }),
    );
    p.on("close", (code) => {
      const raw = stdout.trim();
      try {
        const j = JSON.parse(raw);
        if (j && typeof j === "object" && "result" in j) {
          if (j.is_error) return done({ ok: false, error: String(j.result || "claude 오류") });
          return done({ ok: true, text: String(j.result ?? "") });
        }
      } catch {
        /* JSON 이 아니면 아래 폴백 */
      }
      if (code === 0 && raw) return done({ ok: true, text: raw }); // 폴백: raw stdout 을 그대로 텍스트로
      done({ ok: false, error: (stderr || raw || `claude 종료 코드 ${code}`).trim().slice(0, 500) });
    });
    p.stdin.on("error", () => {});
    p.stdin.write(input, "utf8"); // 명령 창(CP949)과 달리 앱은 항상 UTF-8 로 넘긴다
    p.stdin.end();
  });
}

export async function runClaude(prompt: string, opts?: { images?: string[]; system?: string }): Promise<RunResult> {
  const s = getSettings();
  let full = opts?.system ? `${opts.system}\n\n${prompt}` : prompt;
  // 비전: 프롬프트 끝에 @/절대/경로 를 공백 구분으로 붙이면 claude 가 이미지를 읽는다.
  if (opts?.images?.length) full += "\n\n" + opts.images.map((p) => `@${p}`).join(" ");

  /**
   * ⚠️ 실측(claude 2.1.x): 프로젝트 밖 사진을 @경로로 붙이면 "파일 읽기 권한이 승인되지 않아 볼 수 없다"는
   *   답이 온다(permission_denials 1개). 명세 작성 시점엔 됐지만 지금 버전에서는 막힌다.
   *   측정: --add-dir <폴더> / --allowedTools Read / 사진 폴더를 cwd 로 실행 — 셋 다 "빨강" 정답, denials 0.
   *   → cwd 를 사진 폴더로 두는 방식을 쓴다. argv 에 경로를 넣지 않으므로 윈도우 shell:true 에서도 인용부호 문제가 없다.
   *   사진이 여러 폴더에 걸치면 나머지 폴더는 --add-dir 로(윈도우는 셸 인용 문제로 생략 — 이 앱은 호출당 사진 1장).
   */
  const dirs = [...new Set((opts?.images ?? []).map((p) => path.dirname(p)))];
  const spawnExtra = dirs.length
    ? { cwd: dirs[0], args: isWin ? [] : dirs.slice(1).flatMap((d) => ["--add-dir", d]) }
    : {};

  await acquire();
  g.__claudeCalls = (g.__claudeCalls ?? 0) + 1;
  try {
    const timeoutMs = s.claudeTimeoutSec * 1000;
    let r = await spawnClaude(config.claudeBin, full, timeoutMs, spawnExtra);
    // 윈도우에서 못 찾으면 claude.cmd / claude.exe 를 명시 시도(미검증)
    if (!r.ok && r.enoent && isWin && config.claudeBin === "claude") {
      for (const alt of ["claude.cmd", "claude.exe"]) {
        r = await spawnClaude(alt, full, timeoutMs, spawnExtra);
        if (r.ok || !r.enoent) break;
      }
    }
    const { enoent: _e, ...rest } = r;
    return rest as RunResult;
  } finally {
    release();
  }
}

/** AI 는 지시해도 앞뒤에 말을 붙인다. ① ```json 펜스 ② 첫 { 또는 [ 부터 마지막 짝 문자까지. */
export function extractJson(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && /^[\s]*[[{]/.test(fence[1])) return fence[1].trim();
  const iObj = text.indexOf("{");
  const iArr = text.indexOf("[");
  const candidates = [iObj, iArr].filter((i) => i >= 0);
  if (!candidates.length) return null;
  const start = Math.min(...candidates);
  const close = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  return text.slice(start, end + 1);
}

export async function runClaudeJson<T>(
  prompt: string,
  schema: z.ZodType<T>,
  opts?: { images?: string[]; system?: string; retries?: number; onRetry?: (why: string) => void },
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const retries = opts?.retries ?? 2;
  const system = opts?.system ? `${opts.system}\n\n${JSON_SYSTEM}` : JSON_SYSTEM;
  let lastErr = "";
  let p = prompt;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await runClaude(p, { images: opts?.images, system });
    if (!r.ok) {
      lastErr = r.error;
      // 구독 한도 초과는 재시도해도 소용없다
      if (/hit your .*limit|usage limit|rate limit/i.test(r.error)) break;
    } else {
      const js = extractJson(r.text);
      if (!js) lastErr = "응답에서 JSON 을 찾지 못했습니다";
      else {
        try {
          const parsed = schema.safeParse(JSON.parse(js));
          if (parsed.success) return { ok: true, data: parsed.data };
          lastErr = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 400);
        } catch (e) {
          lastErr = `JSON 파싱 실패: ${(e as Error).message}`;
        }
      }
    }
    if (attempt < retries) {
      opts?.onRetry?.(lastErr);
      // Zod 검증 실패도 재시도 사유. 무엇이 틀렸는지 알려주고 다시 요청.
      p = `${prompt}\n\n[이전 응답이 거절된 이유: ${lastErr}]\n위 문제를 고쳐서 다시 JSON 만 출력하라.`;
    }
  }
  return { ok: false, error: lastErr };
}

export async function checkClaude(): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const p = spawn(config.claudeBin, ["--version"], { shell: isWin, windowsHide: true });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      p.kill("SIGKILL");
      resolve({ ok: false, error: "응답 없음" });
    }, 15000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, error: e.message });
    });
    p.on("close", (code) => {
      clearTimeout(t);
      if (code === 0 && out.trim()) resolve({ ok: true, version: out.trim() });
      else resolve({ ok: false, error: (err || out || `exit ${code}`).trim() });
    });
  });
}
