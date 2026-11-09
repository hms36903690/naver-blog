import type { Mode, PhotoSource, Target } from "../types";

/** 모든 모드 공통: 마크다운 금지 + 섹션 JSON 형식 설명 */
export const SECTION_FORMAT = `
출력 형식(JSON 객체 하나):
{
  "title": "글 제목",
  "sections": [
    {"type":"paragraph","text":"문단 내용","highlight":"text 안에 글자 그대로 있는 핵심 구절(선택)"},
    {"type":"quote","text":"짧은 한 줄"},
    {"type":"heading","text":"소제목"},
    {"type":"divider"},
    {"type":"image","query":"(사진 자리 안내 — 아래 사진 규칙)","caption":"사진 아래 짧은 설명(선택)"}
  ]
}

공통 규칙:
- 마크다운 기호(**, ~~, ~, #, >, 백틱, - 목록)를 절대 쓰지 마라. 강조는 highlight 필드로만 한다.
- highlight 는 반드시 같은 문단 text 안에 "글자 그대로" 있는 구절이어야 한다. 새 문장을 지어내지 마라.
  문단당 최대 1개, 전체 문단의 30% 정도에만 넣어라.
- 문단은 2~4줄로 짧게.
- 사람이 직접 쓴 듯한 자연스러운 문장. "~에 대해 알아보겠습니다", "결론적으로" 같은 AI 티 나는 표현 금지.
`.trim();

export function photoHintFor(photoSource: PhotoSource, count = 0, descs?: Array<{ name: string; desc: string }>): string {
  switch (photoSource) {
    case "none":
      return "사진 규칙: image 섹션을 하나도 만들지 마라.";
    case "local": {
      const list = (descs ?? []).map((d, i) => `  ${i + 1}. ${d.name} — ${d.desc}`).join("\n");
      return [
        `사진 규칙: image 섹션을 정확히 ${count}개 만들어라. 더도 덜도 안 된다.`,
        `query 에는 검색어가 아니라 "그 자리에 어떤 사진이 와야 하는지" 한 줄 설명을 써라.`,
        `caption 은 사진 아래에 들어갈 짧은 설명(20자 내외).`,
        list ? `사용할 수 있는 사진 목록(이 사진들이 실제로 들어간다):\n${list}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "ai":
      return [
        "사진 규칙: image 섹션을 6~8개 넉넉히 배치하라(일부는 생성에 실패할 수 있다).",
        "query 에는 \"어떤 장면을 그려야 하는지\" 한국어로 구체적으로 묘사하라(피사체·구도·분위기).",
        "사람 얼굴이 주인공이 아닌 장면(사물·풍경·클로즈업·손동작·뒷모습)으로.",
        "caption 은 사진 아래 짧은 설명(20자 내외).",
      ].join("\n");
    case "crawl":
      return [
        "사진 규칙: image 섹션을 6~8개 넉넉히 배치하라(일부 자리는 적합한 사진을 못 찾는다).",
        "query 에는 이미지 검색어(2~4단어)를 써라.",
        "사람 얼굴이 주인공이 아닌 사물·풍경·클로즈업·손동작 위주의 검색어로.",
        "caption 은 사진 아래 짧은 설명(20자 내외).",
      ].join("\n");
  }
}

const REVIEW = `
너는 네이버 블로그 체험단 후기를 쓰는 블로거다.
- 철저히 1인칭("저희는", "~했어요", "~더라구요"). "ㅎㅎ", "진짜" 같은 표현을 자연스럽게 섞어라.
- 도입에서 결론을 살짝 흘려라(예: "결론부터 말하면 또 갈 것 같아요").
{{HEADING_RULE}}
- 실용 정보를 구획별로: 가는 법 / 웨이팅 / 가격 / 언제 가면 좋은지 / 주의점 (주제에 맞는 것만).
- 문단 1~2개마다 사진 1장의 리듬.
- 마무리는 총평 + "다시 간다면" 팁.
- 사용자가 준 핵심 내용에 없는 사실(가격·메뉴명·주소 등)을 지어내지 마라. 모르면 쓰지 마라.
`.trim();

const BRANDING = `
너는 해당 분야 전문가로서 네이버 블로그에 전문성 글을 쓴다. "~입니다" 전문가체.
구조 고정:
 ① 권위 선점(숫자 실적) ② 독자의 문제/오해 짚기 ③ 왜 그 방법이 안 통하는지
 ④ 이름 붙인 자체 프레임워크(예: "3단계 ○○ 법") ⑤ 예상 반박 Q&A ⑥ 정리 + 행동 유도
{{HEADING_RULE}}
- 구획 전환에 divider 를 1~2회.
- 숫자·실적을 절대 지어내지 마라. 사용자가 준 내용 안에서만 써라. 없으면 숫자 없이 써라.
`.trim();

/**
 * 네이버: 상위 노출 블로그 문법대로 소제목을 인용구로.
 * 티스토리: 구글 검색·애드센스 독자 — 소제목은 heading(H2), 첫 문단에 핵심 답, 끝에 자주 묻는 질문.
 */
const HEADING_RULE: Record<Target, string> = {
  naver: "- 소제목은 heading 이 아니라 quote 로 만든다. quote 는 15~30자 짧은 한 줄.",
  tistory: "- 소제목은 heading 으로 만든다(검색엔진이 읽는 H2). quote 는 꼭 필요할 때만.",
};

export function platformStyle(target: Target, styleGuide = ""): string {
  if (target === "naver") return "";
  const own = styleGuide.trim()
    ? `\n\n이 블로그 고유의 글투(사장님 블로그 최근 글에서 배운 것 — 위 규칙과 겹치면 이쪽을 따르되, 문장을 베끼지는 마라):\n${styleGuide.trim()}`
    : "";
  return `
티스토리(구글 검색) 문체 규칙:
- 독자는 구글에서 검색해서 들어온 사람이다. 첫 문단 2~3줄 안에 검색한 질문의 핵심 답을 먼저 준다.
- 소제목(heading) 3~6개로 구획을 나누고, 소제목에는 사람들이 검색할 만한 말을 자연스럽게 넣는다.
- 과장·낚시성 표현, 같은 말 반복, 키워드 나열을 하지 마라(애드센스 정책상 "가치가 낮은 글"로 보일 수 있다).
- 마지막에 heading "자주 묻는 질문" 과, 질문 한 줄 + 답 2~3줄 문단을 2~3쌍 둔다.
- 확인되지 않은 사실·숫자·가격은 쓰지 마라. 모르면 "직접 확인이 필요하다"고 쓴다.
`.trim() + own;
}

export function modePrompt(
  mode: Exclude<Mode, "auto">,
  topic: string,
  details: string,
  photoHint: string,
  target: Target = "naver",
  styleGuide = "",
) {
  return [
    (mode === "review" ? REVIEW : BRANDING).replace("{{HEADING_RULE}}", HEADING_RULE[target]),
    platformStyle(target, styleGuide),
    "",
    `주제: ${topic}`,
    `사용자가 준 핵심 내용:\n${details || "(없음 — 주제만으로 일반적인 내용으로 쓰되 사실을 지어내지 마라)"}`,
    "",
    photoHint,
    "",
    SECTION_FORMAT,
  ].join("\n");
}
