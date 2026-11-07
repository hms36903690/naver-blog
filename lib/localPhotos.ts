import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { runClaudeJson } from "./claude";
import { expandHome } from "./paths";

const EXT = /\.(jpe?g|png|webp|heic)$/i;
export type LocalPhoto = { name: string; path: string };
export type PhotoDesc = { name: string; desc: string };

/** 폴더의 사진 목록 — 파일명 자연순(사진1, 사진2, 사진10). */
export function listLocalPhotos(folder: string): LocalPhoto[] {
  const dir = path.resolve(expandHome(folder.trim()));
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error("사진 폴더를 찾을 수 없습니다.");
  return fs
    .readdirSync(dir)
    .filter((f) => EXT.test(f) && !f.startsWith("."))
    .sort((a, b) => a.localeCompare(b, "ko", { numeric: true }))
    .map((name) => ({ name, path: path.join(dir, name) }));
}

/**
 * 사진마다 한 줄 설명(30자). 직접 찍은 사진이므로 워터마크·초상권 필터는 적용하지 않는다.
 * ⚠️ 본문 생성 전에 "한 번만" 만들고, 그 결과를 프롬프트와 배치에 재사용한다(두 번 만들면 claude 호출이 배).
 */
export async function describePhotos(photos: LocalPhoto[], log?: (m: string) => void): Promise<PhotoDesc[]> {
  const out = await Promise.all(
    photos.map(async (p) => {
      const r = await runClaudeJson(
        '첨부한 사진이 무엇을 보여주는지 한국어 30자 이내 한 줄로 설명하라. 출력: {"desc":"..."}',
        z.object({ desc: z.string() }),
        { images: [p.path], retries: 1 },
      );
      const desc = r.ok ? r.data.desc.slice(0, 40) : "";
      // 사진을 못 읽었다는 답을 "설명"으로 쓰지 않는다
      return { name: p.name, desc: desc && !/권한|읽을 수 없|확인할 수 없/.test(desc) ? desc : "(설명 실패)" };
    }),
  );
  log?.(`내 사진 ${photos.length}장 설명을 만들었습니다`);
  return out;
}

/**
 * 사진을 이미지 자리에 배치. 결과: 자리 순서대로 사진 인덱스.
 * ai 방식은 설명과 캡션을 claude 로 매칭하되, 매칭 실패·누락분은 순서대로 채운다(폴백 필수).
 */
export async function placePhotos(
  slots: Array<{ query: string; caption?: string | null }>,
  descs: PhotoDesc[],
  method: "order" | "ai",
): Promise<number[]> {
  const n = Math.min(slots.length, descs.length);
  const order = Array.from({ length: n }, (_, i) => i);
  if (method === "order" || n <= 1) return order;

  const prompt = `
블로그 글의 사진 자리와 사진 목록이 있다. 각 자리에 가장 어울리는 사진 번호를 하나씩 배정하라. 사진은 한 번씩만 쓴다.

자리:
${slots.slice(0, n).map((s, i) => `${i}. ${s.query}${s.caption ? ` (캡션: ${s.caption})` : ""}`).join("\n")}

사진:
${descs.map((d, i) => `${i}. ${d.desc}`).join("\n")}

출력: {"assign":[자리0의 사진번호, 자리1의 사진번호, ...]}
`.trim();
  const r = await runClaudeJson(prompt, z.object({ assign: z.array(z.number().int()) }), { retries: 1 });
  const used = new Set<number>();
  const result: number[] = new Array(n).fill(-1);
  if (r.ok) {
    r.data.assign.slice(0, n).forEach((pi, si) => {
      if (pi >= 0 && pi < descs.length && !used.has(pi)) {
        result[si] = pi;
        used.add(pi);
      }
    });
  }
  // 폴백: 비거나 중복된 자리는 안 쓴 사진을 순서대로
  const rest = descs.map((_, i) => i).filter((i) => !used.has(i));
  for (let i = 0; i < n; i++) if (result[i] === -1) result[i] = rest.shift()!;
  return result;
}
