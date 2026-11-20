import type { Draft } from "./types";

/**
 * 네이버 인바운드: 글 끝에 [구분선 → 안내 문단 → 신청서 주소] 를 붙인다.
 * 네이버 상업성 판정을 피하려고 글당 1개, 짧고 담백하게(사용자에게 안내한 원칙).
 */
export function appendNaverCta(d: Draft, text: string, url: string): Draft {
  if (!url.trim()) return d;
  const t = (text || "").trim() || "상담이 필요하시면 아래에서 신청해 주세요.";
  return {
    ...d,
    sections: [
      ...d.sections,
      { type: "divider" },
      { type: "paragraph", text: t, highlight: null },
      { type: "paragraph", text: `▶ 무료 상담 신청: ${url.trim()}`, highlight: null },
    ],
  };
}
