// 단계 2 검증: claude 래퍼 — 버전, 긴 한글, JSON 펜스, Zod 검증
import { z } from "zod";
import { checkClaude, extractJson, runClaude, runClaudeJson } from "@/lib/claude";

async function main() {
  console.log("version:", await checkClaude());

  // 펜스·앞뒤 말이 붙어도 JSON 추출
  console.log("extract fence:", extractJson('네 여기요\n```json\n{"a":1}\n```\n끝'));
  console.log("extract bare:", extractJson('결과는 [1,2,3] 입니다'));

  // 2,000자 이상 한글 프롬프트가 stdin 으로 깨지지 않는지: 마지막 단어를 되묻는다
  const long = "가나다라마바사아자차카타파하 ".repeat(160) + "\"마지막단어는 호랑이\"";
  console.log("long prompt chars:", long.length);
  const r = await runClaude(`${long}\n\n위 글의 맨 마지막 따옴표 안 문장에서 마지막 단어 하나만 답하라.`);
  console.log("long result:", r);

  const j = await runClaudeJson(
    "한국의 사계절 이름을 순서대로 JSON 으로. 형식: {\"seasons\": [\"봄\", ...]}. 반드시 ```json 코드펜스로 감싸서 답하라.",
    z.object({ seasons: z.array(z.string()).length(4) }),
  );
  console.log("json:", JSON.stringify(j));
}
main();
