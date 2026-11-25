import fs from "node:fs";
import path from "node:path";
import { detectImage, extFor, needsConversion } from "../imageType";
import { neutralizeMarkdown } from "../text";
import type { Draft } from "../types";

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * 섹션 배열 → 티스토리 본문 HTML.
 * 사진은 티스토리 서버에 올라가야 하는데, 업로드 경로는 아직 실측 전이다 →
 * v1 은 사진 자리에 눈에 띄는 안내문을 넣고, 사진 파일은 data/images/jobN 에 준비해 둔다(사람이 검토하며 끌어다 넣음).
 */
/**
 * 노란 안내문의 "사진 N" 번호와 똑같은 이름으로 올릴 사진만 따로 모아 둔다(images/jobN/올릴사진/사진 1.png …).
 * 이유: 생성·검색 과정의 파일(ai-0-0.png, 탈락한 후보 등)이 섞여 있으면 사람이 어느 게 몇 번인지 알 수 없다.
 * 번호 매기는 순서는 draftToTistoryHtml 과 같다(섹션 순서, 사진을 구한 자리만).
 */
export function exportPhotosForUpload(d: Draft, images: Map<number, string>, outDir: string, warn?: (m: string) => void): string[] {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const out: string[] = [];
  d.sections.forEach((s, i) => {
    const src = images.get(i);
    if (s.type !== "image" || !src || !fs.existsSync(src)) return;
    const buf = fs.readFileSync(src);
    const kind = detectImage(buf);
    const dest = path.join(outDir, `사진 ${out.length + 1}${extFor(kind)}`);
    fs.writeFileSync(dest, buf);
    if (needsConversion(kind)) warn?.(`「사진 ${out.length + 1}」은 ${kind.toUpperCase()} 형식이라 티스토리 웹에 안 올라갈 수 있습니다. JPG 로 바꿔 올려 주세요(아이폰은 설정 → 카메라 → 포맷 → '높은 호환성'으로 찍으면 처음부터 JPG 로 저장됩니다).`);
    out.push(dest);
  });
  return out;
}

export function draftToTistoryHtml(d: Draft, images: Map<number, string>): { html: string; photoSlots: number } {
  let n = 0;
  const out: string[] = [];
  d.sections.forEach((s, i) => {
    switch (s.type) {
      case "heading":
        out.push(`<h2>${esc(neutralizeMarkdown(s.text))}</h2>`);
        break;
      case "paragraph": {
        const text = neutralizeMarkdown(s.text);
        const hl = s.highlight ? neutralizeMarkdown(s.highlight) : "";
        const at = hl ? text.indexOf(hl) : -1; // 7-24 이중 방어
        out.push(
          at < 0
            ? `<p>${esc(text)}</p>`
            : `<p>${esc(text.slice(0, at))}<b>${esc(hl)}</b>${esc(text.slice(at + hl.length))}</p>`,
        );
        break;
      }
      case "quote":
        out.push(`<blockquote>${esc(neutralizeMarkdown(s.text))}</blockquote>`);
        break;
      case "divider":
        out.push("<hr>");
        break;
      case "image": {
        if (!images.has(i)) break; // 사진을 못 구한 자리는 비운다
        n++;
        const cap = s.caption ? ` — ${esc(neutralizeMarkdown(s.caption))}` : "";
        out.push(`<p style="background:#fff3cd;border:1px dashed #d6a419;padding:8px;text-align:center">[📷 사진 ${n}${cap}] ← 앱의 [사진 폴더 열기]로 연 폴더에서 「사진 ${n}」을 여기로 끌어다 놓고, 이 줄은 지우세요</p>`);
        break;
      }
    }
  });
  return { html: out.join("\n"), photoSlots: n };
}
