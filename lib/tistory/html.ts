import { neutralizeMarkdown } from "../text";
import type { Draft } from "../types";

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * 섹션 배열 → 티스토리 본문 HTML.
 * 사진은 티스토리 서버에 올라가야 하는데, 업로드 경로는 아직 실측 전이다 →
 * v1 은 사진 자리에 눈에 띄는 안내문을 넣고, 사진 파일은 data/images/jobN 에 준비해 둔다(사람이 검토하며 끌어다 넣음).
 */
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
        out.push(`<p style="background:#fff3cd;border:1px dashed #d6a419;padding:8px;text-align:center">[📷 사진 ${n}${cap}] ← 여기에 사진 ${n}을 넣고 이 줄은 지우세요</p>`);
        break;
      }
    }
  });
  return { html: out.join("\n"), photoSlots: n };
}
