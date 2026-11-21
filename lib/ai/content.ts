import { runClaudeJson } from "../claude";
import { CATEGORY_LABEL, draftSchemaFor, NAVER_CATEGORIES, IdeaList, type Category, type Draft, type Idea, type PhotoSource, type Source, type Target } from "../types";
import { categoryInstruction, photoHintFor, platformStyle, SECTION_FORMAT } from "./templates";

function packSources(sources: Source[]): string {
  return sources
    .map((s, i) => `[${i + 1}] (${s.type === "news" ? "뉴스" : "블로그"}) ${s.title}\n${s.summary}`.slice(0, 400))
    .join("\n\n");
}

export async function generateIdeas(
  keyword: string,
  sources: Source[],
  n = 5,
  onRetry?: (w: string) => void,
  target: Target = "naver",
  styleGuide = "",
  category?: Category,
) {
  const forTistory =
    target === "tistory"
      ? `
이 글감은 티스토리(구글 검색) 블로그용이다.
- 제목은 사람들이 구글에 실제로 검색할 질문·문구를 자연스럽게 담는다(예: "공복혈당 110 정상인가요? 수치별 의미와 관리법").
- 지금 화제인 것(자료 근거)과 꾸준히 검색되는 것을 섞는다.
- 낚시성·과장 제목, 확인 안 된 숫자 금지. 건강·금융은 단정하는 표현을 피한다.
${category ? `- 카테고리 "${CATEGORY_LABEL[category]}" 에 맞는 글감만 낸다.\n` : ""}- 이 블로그가 다루는 주제와 독자에 맞춘다:
${styleGuide.trim() || "(글투 안내 없음)"}
`
      : `
이 글감은 사업자 정보 네이버 블로그용이다(독자: 소상공인·개인사업자·법인 대표).
- 주제 범위: 세금, 자금(정책자금·대출·지원금), 임금·노무, 임대료, 증여·상속, 재무.
${category && NAVER_CATEGORIES.includes(category) ? `- 카테고리 "${CATEGORY_LABEL[category]}" 에 맞는 글감만 낸다.\n` : ""}- 제목은 사장님들이 네이버에 실제로 검색할 문구를 담는다(예: "종합소득세 신고기간 개인사업자 준비서류 총정리", "주휴수당 계산법 알바 주 15시간").
- 신고·납부 기한이 다가오는 것, 올해 바뀐 제도처럼 지금 필요한 정보를 우선한다. 확인 안 된 숫자·낚시성 제목 금지.
`;
  const prompt = `
너는 ${target === "tistory" ? "티스토리" : "네이버"} 블로그 기획자다. 키워드 "${keyword}" 로 최근 수집한 자료가 아래에 있다.
지금 사람들이 궁금해할 만한 블로그 글감 ${n}개를 만들어라. 가장 좋은 것을 첫 번째에 둬라. 서로 겹치지 않게.
${forTistory}
수집 자료:
${packSources(sources) || "(자료 없음 — 키워드만 보고 판단)"}

출력: JSON 배열. 각 원소 {"title": 글 제목, "angle": 어떤 관점으로 쓸지, "rationale": 왜 지금 이 글감인지(자료 번호 근거)}
`.trim();
  return runClaudeJson(prompt, IdeaList, { onRetry });
}

export async function generateDraft(
  keyword: string,
  idea: Idea,
  sources: Source[],
  photoSource: PhotoSource,
  onRetry?: (w: string) => void,
  target: Target = "naver",
  styleGuide = "",
  category?: Category,
  authorBio = "",
) {
  const prompt = `
너는 블로그에 글을 쓰는 사람이다. 아래 글감으로 본문을 써라.

키워드: ${keyword}
글감 제목: ${idea.title}
관점: ${idea.angle}

참고 자료(문장을 그대로 베끼지 말고 내용만 참고하라):
${packSources(sources) || "(자료 없음)"}

구성:
- 도입(공감/후킹) → 본문(소제목 2~4구획, 소제목은 heading 으로) → 마무리(요약/행동유도)
- 사람이 쓴 듯한 구어체. AI 티 나는 표현 금지.
${platformStyle(target, styleGuide, category, authorBio)}

${photoHintFor(photoSource, 0, undefined, target)}

${SECTION_FORMAT}
${categoryInstruction(target, category)}
`.trim();
  return runClaudeJson(prompt, draftSchemaFor(photoSource, 0, target), { onRetry });
}

/**
 * ⚠️ 7-24: AI 는 본문에 없는 highlight 를 지어낸다(실측 5개 중 1개).
 * 형광펜은 text.indexOf(highlight) 로 자리를 찾으므로 그대로 두면 서식이 엉뚱한 곳에 붙는다.
 * → 그 highlight 만 떨어뜨리고 개수를 보고한다. 초안 전체를 반려하지 않는다(생성 100초 vs 형광펜 하나).
 */
export function sanitizeDraft(d: Draft): { draft: Draft; droppedHighlights: number } {
  let dropped = 0;
  const sections = d.sections.map((s) => {
    if (s.type !== "paragraph" || !s.highlight) return s;
    if (s.text.includes(s.highlight)) return s;
    dropped++;
    return { ...s, highlight: null };
  });
  return { draft: { ...d, sections }, droppedHighlights: dropped };
}
