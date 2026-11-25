import type { Draft } from "./types";

/**
 * 보험설계사용 광고 안전장치(사용자: 보험설계사, 네이버 사업자 블로그 + 상담 신청).
 * ⚠️ 법률 판단이 아니다 — 소속 회사 준법감시 심의를 대신하지 않는다. 심의에서 문제 될 만한 표현을 미리 걸러 낼 뿐.
 *
 * 걸러 내는 것: 민간 보험 상품명, 보험사 이름, 보험 가입·설계 권유, 보장 내용 표현.
 * 걸러 내지 않는 것(사회보험·공공기관): 국민건강보험(공단)·고용보험·산재보험·4대보험·국민연금 — 사업자 글에 늘 나온다.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/(종신|정기|변액|실손|실비|암|상해|운전자|치아|간병|어린이|태아|CEO|경영인|저축성?|연금저축)\s*보험/g, "보험 상품명"],
  [/CEO\s*플랜|경영인\s*플랜|임원\s*퇴직금\s*플랜/gi, "보험 상품명"],
  [/(?<!국민)(?<!산재)(?<!고용)(?<!사회)(?<!4대)연금\s*보험/g, "보험 상품명"],
  [/보험\s*(가입|상품|설계|리모델링|추천|비교|갈아타기)/g, "보험 가입·설계 권유"],
  [/보험료\s*(아끼|절약|줄이|비교|싸)/g, "보험료 비교·절감 권유"],
  [/가입\s*(하세요|해\s*보세요|을\s*권|을\s*추천|하시길)/g, "가입 권유"],
  [/보장\s*(금|내용|받|해\s*드|성\s*보험|분석)/g, "보장 내용"],
  [/(삼성|한화|교보|신한|KB|메리츠|현대|DB|흥국|동양|라이나|AIA|메트라이프|푸본|NH|미래에셋|ABL|DGB|KDB|하나|롯데|MG|처브|카디프|IBK|BNP)\s*(생명|화재|손해보험|손보|라이프)/g, "보험사 이름"],
];

export type ComplianceHit = { word: string; kind: string };

export function scanCompliance(d: Draft): ComplianceHit[] {
  const text = [d.title, ...d.sections.map((s) => ("text" in s ? s.text : "") + ("caption" in s && s.caption ? " " + s.caption : "")), ...(d.tags ?? [])].join("\n");
  const hits: ComplianceHit[] = [];
  for (const [re, kind] of PATTERNS) for (const m of text.matchAll(re)) if (!hits.some((h) => h.word === m[0])) hits.push({ word: m[0], kind });
  return hits;
}

/** 심의필 번호·필수 안내 문구를 글 끝에 붙인다(저장된 초안은 바꾸지 않는다 — 다시 시도 때 두 번 붙지 않도록). */
export function appendComplianceNotice(d: Draft, notice: string): Draft {
  const t = notice.trim();
  if (!t) return d;
  return { ...d, sections: [...d.sections, ...t.split(/\n+/).map((line) => ({ type: "paragraph" as const, text: line.trim(), highlight: null })).filter((p) => p.text)] };
}

/** AI 에게 주는 규칙 */
export const COMPLIANCE_RULE = `
보험 광고 규정(필자는 보험설계사 — 반드시 지킬 것):
- 보험 상품명(종신·변액·실손·CEO플랜 등), 보험사 이름, 보장 내용·보험금·보험료 비교, 보험 가입·설계 권유를 절대 쓰지 마라.
- "보험으로 해결", "가입하면 보장" 같은 상품 연결 문장도 쓰지 마라. 세금·인건비·자금 정보 자체만 다룬다.
- 국민건강보험·고용보험·산재보험·4대보험·국민연금 같은 사회보험·공공 제도 설명은 괜찮다.
- 필자의 소속 회사나 설계사 신분을 글에 밝히지 마라(심의 전).
`.trim();
