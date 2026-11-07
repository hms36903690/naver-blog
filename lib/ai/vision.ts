import { runClaudeJson } from "../claude";
import { CrawlVerdict, GenVerdict } from "../types";

/**
 * 크롤링 이미지 판정 — 세 축을 따로 묻는다.
 * 코드에서 watermark || koreanPerson 이면 fit 을 강제로 false. AI 가 fit=true 라고 해도 무시.
 * ⚠️ 판정 호출이 실패하면 그 이미지는 채택하지 않는다 → claude 한도 초과가 "검증 안 된 이미지 통과"가 되면 안 된다.
 */
export async function judgeCrawled(imagePath: string, query: string, context: string): Promise<CrawlVerdict> {
  const prompt = `
블로그 글에 넣을 사진 후보를 판정하라. 첨부된 이미지를 직접 보고 답하라.

이 자리에 필요한 사진: ${query}
글 맥락: ${context.slice(0, 300)}

세 가지를 따로 판단하라:
- watermark: 워터마크/사이트 로고/저작권 표기/서명/스톡 출처표시/배너 문구가 "조금이라도" 보이면 true. 의심스러우면 true.
- koreanPerson: 한국인(동아시아인) 얼굴이 식별 가능하면 true (초상권 위험). 얼굴이 안 보이거나(뒷모습·손·실루엣) 명백한 외국인 스톡이면 false. 애매하면 true.
- fit: 위 둘이 문제없다는 전제에서 주제와 이 자리에 어울리면 true.
- reason: 한 줄 이유.

출력: {"fit":bool,"watermark":bool,"koreanPerson":bool,"reason":"..."}
`.trim();
  const r = await runClaudeJson(prompt, CrawlVerdict, { images: [imagePath], retries: 1 });
  if (!r.ok) return { fit: false, watermark: false, koreanPerson: false, reason: `판정 실패: ${r.error.slice(0, 120)}` };
  const v = r.data;
  if (v.watermark || v.koreanPerson) v.fit = false;
  return v;
}

export function crawlRejectReason(v: CrawlVerdict): string {
  if (v.reason.startsWith("판정 실패")) return v.reason;
  if (v.watermark) return `워터마크 — ${v.reason}`;
  if (v.koreanPerson) return `국내 인물(초상권) — ${v.reason}`;
  if (!v.fit) return `주제 불일치 — ${v.reason}`;
  return v.reason;
}

/**
 * ⚠️ 7-13: 생성 이미지에 크롤링용 판정을 쓰지 마라. 워터마크·초상권은 원천적으로 없고
 * koreanPerson 필터가 멀쩡한 생성물을 떨어뜨린다. "주제 불일치 / 형태 깨짐 / 글자 혼입 / 저품질" 네 가지만 본다.
 */
export async function judgeGenerated(imagePath: string, scene: string): Promise<GenVerdict> {
  const prompt = `
AI 가 생성한 블로그용 이미지를 검수하라. 첨부된 이미지를 직접 보고 답하라.
그려야 했던 장면: ${scene}

- offTopic: 장면과 무관하면 true
- deformed: 손가락·사물·구조가 기형적으로 깨졌으면 true
- hasText: 글자·숫자·가짜 문자(예: 'Wmt13', 'HUMIDETRICE')가 보이면 true
- lowQuality: 흐리거나 조잡하면 true
- ok: 위 넷이 모두 false 일 때만 true
- reason: 한 줄

출력: {"ok":bool,"offTopic":bool,"deformed":bool,"hasText":bool,"lowQuality":bool,"reason":"..."}
`.trim();
  const r = await runClaudeJson(prompt, GenVerdict, { images: [imagePath], retries: 1 });
  if (!r.ok) return { ok: false, offTopic: false, deformed: false, hasText: false, lowQuality: false, reason: `판정 실패: ${r.error.slice(0, 120)}` };
  const v = r.data;
  v.ok = !v.offTopic && !v.deformed && !v.hasText && !v.lowQuality;
  return v;
}
