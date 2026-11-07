/**
 * ⚠️ 7-8: 스마트에디터는 입력 중 `~~취소선~~`, `**굵게**`, 줄머리 `#` `>` `-` 를 서식으로 자동 변환한다.
 * 한국어 구어체 물결표(~)가 특히 위험. AI 에게 "마크다운 금지"를 지시하는 것만으로는 부족 → 타이핑 직전에 무력화.
 */
export function neutralizeMarkdown(text: string): string {
  return text
    .replace(/~+/g, "～") // 전각 물결표로 (어감은 보존)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]+/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "");
}

/** 초안 텍스트에 마크다운 기호가 남았는지(검증용). */
export function markdownLeaks(text: string): string[] {
  const found: string[] = [];
  if (/\*\*/.test(text)) found.push("**");
  if (/~~/.test(text)) found.push("~~");
  if (/`/.test(text)) found.push("`");
  if (/^[ \t]*#{1,6}[ \t]+/m.test(text)) found.push("#");
  if (/^[ \t]*>[ \t]+/m.test(text)) found.push(">");
  if (/^[ \t]*[-*+][ \t]+/m.test(text)) found.push("- 목록");
  return found;
}

/** ⚠️ 7-25: VS16(U+FE0F) 이 붙은 글자만 따로 잘라낸다. */
export const HAS_VS16 = /️/;
export const VS16_CLUSTER = /([\s\S]️⃣?)/; // ⚠️ ❤️ ✔️ ☀️ 1️⃣

export const codepoints = (t: string) =>
  [...t].map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase()).join(" ");
