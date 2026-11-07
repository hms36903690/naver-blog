import fs from "node:fs";
import path from "node:path";
import { config, hasCloudflare } from "@/config";
import { runClaudeJson } from "../claude";
import { getDb } from "../db";
import { paths } from "../paths";
import { PromptDesign, type ImageStyle } from "../types";
import { neuronsPerImage } from "./neurons";
import { judgeGenerated } from "./vision";

const STYLE_TOKENS: Record<ImageStyle, string> = {
  photo: "photorealistic photograph, natural lighting, shallow depth of field, 50mm lens, high detail",
  illust: "clean flat vector illustration, simple shapes, soft muted color palette, minimal, lots of white space",
};
const TAIL = "no text, no letters, no words, no watermark, no logo";

/** ① claude 가 FLUX 용 영문 프롬프트를 설계 */
export async function designPrompt(
  title: string,
  scene: string,
  context: string,
  style: ImageStyle,
  feedback?: string,
): Promise<{ ok: true; prompt: string } | { ok: false; error: string }> {
  const p = `
너는 이미지 생성 모델(FLUX) 프롬프트 작성자다. 블로그 글 "${title}" 의 한 자리에 들어갈 이미지를 설계하라.

그 자리에 필요한 장면: ${scene}
앞뒤 문단 맥락: ${context.slice(0, 400)}
${feedback ? `\n이전 생성물이 탈락한 이유(반드시 고쳐라): ${feedback}\n` : ""}
규칙(고정):
- 영어, 한 문단, 40단어 이내
- 피사체 / 구도 / 조명 / 배경 / 질감을 명시
- 다음 스타일 토큰을 반드시 포함: "${STYLE_TOKENS[style]}"
- 끝에 반드시: "${TAIL}"
- 실존 인물·유명인·브랜드 로고 금지
- 사람이 필요하면 얼굴이 크게 나오지 않는 구도(손·뒷모습·실루엣)
- 한국적 맥락은 반영하되 한글 간판·글자는 넣지 마라(생성 모델이 한글을 깨뜨린다)
- 계기판·다이얼·눈금처럼 글자/숫자가 생기기 쉬운 사물은 피하거나 멀리서 잡아라

출력: {"prompt":"..."}
`.trim();
  const r = await runClaudeJson(p, PromptDesign, { retries: 1 });
  if (!r.ok) return r;
  let prompt = r.data.prompt.trim();
  if (!prompt.includes(STYLE_TOKENS[style])) prompt = `${prompt}, ${STYLE_TOKENS[style]}`;
  if (!/no text, no letters/.test(prompt)) prompt = `${prompt}, ${TAIL}`;
  return { ok: true, prompt };
}

/** ② Cloudflare Workers AI 로 생성. 응답은 바이너리가 아니라 base64 JSON. */
export async function generateImage(
  prompt: string,
  steps: number,
  outPath: string,
  jobId?: number,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (!hasCloudflare()) return { ok: false, error: "Cloudflare 키 없음" };
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.cfAccountId}/ai/run/${config.cfModel}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90_000);
  const st = Math.min(Math.max(steps, 1), 8);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.cfApiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, steps: st }),
      signal: ctrl.signal,
    });
    let buf: Buffer;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = (await res.json()) as { result?: { image?: string }; errors?: Array<{ message: string }>; success?: boolean };
      if (!res.ok || !j.result?.image) return { ok: false, error: j.errors?.[0]?.message || `HTTP ${res.status}` };
      buf = Buffer.from(j.result.image, "base64");
    } else {
      // SDXL 계열은 바이너리로 준다 — 모델 교체 대비
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      buf = Buffer.from(await res.arrayBuffer());
    }
    // 사용량 기록(실측 조회가 안 될 때 추정치의 근거)
    getDb().prepare("INSERT INTO cf_usage (job_id, steps, neurons, ok) VALUES (?,?,?,?)").run(jobId ?? null, st, neuronsPerImage(st), buf.length >= 2000 ? 1 : 0);
    if (buf.length < 2000) return { ok: false, error: "생성 실패(이미지가 너무 작음)" };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    return { ok: true, path: outPath };
  } catch (e) {
    return { ok: false, error: (e as Error).name === "AbortError" ? "생성 시간 초과(90초)" : (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

/** ①→②→③ 검증. 부적합하면 이유를 되먹여 1회만 재생성(무한 루프 금지). */
export async function generateForSlot(args: {
  jobId: number;
  title: string;
  scene: string;
  context: string;
  style: ImageStyle;
  steps: number;
  slotIndex: number;
  log: (m: string, lvl?: "info" | "warn") => void;
}): Promise<{ ok: true; path: string; prompt: string } | { ok: false; reason: string; prompt?: string }> {
  let feedback: string | undefined;
  let lastPrompt: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const d = await designPrompt(args.title, args.scene, args.context, args.style, feedback);
    if (!d.ok) return { ok: false, reason: `프롬프트 설계 실패: ${d.error.slice(0, 100)}` };
    lastPrompt = d.prompt;
    const out = path.join(paths.images, `job${args.jobId}`, `ai-${args.slotIndex}-${attempt}.png`);
    const g = await generateImage(d.prompt, args.steps, out, args.jobId);
    if (!g.ok) return { ok: false, reason: g.error, prompt: d.prompt };
    const v = await judgeGenerated(g.path, args.scene);
    if (v.ok) return { ok: true, path: g.path, prompt: d.prompt };
    feedback = v.reason;
    args.log(`생성 사진 ${args.slotIndex + 1}번 자리 탈락(${v.reason}) ${attempt === 0 ? "— 1회 다시 만듭니다" : "— 건너뜁니다"}`, "warn");
  }
  return { ok: false, reason: `재생성 후에도 부적합: ${feedback}`, prompt: lastPrompt };
}
