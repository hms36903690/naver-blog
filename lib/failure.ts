/**
 * 발행 실패 조치 안내 — 실패 문구(posts.note / jobs.error)를 보고 "무슨 일인지 + 사장님이 할 일 + 누를 버튼"을 정한다.
 * 클라이언트에서도 쓰므로 DB·fs 를 import 하지 않는 순수 함수.
 */
export type FixAction =
  | "retry" // 글·그림 그대로 발행만 다시
  | "remake" // 처음부터 다시 만들기(같은 입력)
  | "naverLogin"
  | "tistoryLogin"
  | "settings"
  | "naverBlog" // 내 네이버 블로그 열어 확인
  | "tistoryWrite"; // 티스토리 글쓰기(임시저장 목록) 열어 확인

export type FixGuide = { title: string; steps: string[]; actions: FixAction[] };

export function diagnoseFailure(text: string, opts: { target: "naver" | "tistory"; hasDraft: boolean }): FixGuide {
  const t = text || "";
  const has = (re: RegExp) => re.test(t);
  const retryOrRemake: FixAction = opts.hasDraft ? "retry" : "remake";

  if (has(/티스토리 주소/))
    return { title: "티스토리 주소가 없거나 맞지 않습니다", steps: ["[설정] → 티스토리 주소에 bnlife3.tistory.com 처럼 넣어 주세요.", "그다음 [다시 시도]를 누르세요."], actions: ["settings", retryOrRemake] };
  if (has(/티스토리 로그인|카카오/))
    return {
      title: "티스토리 로그인이 풀렸습니다",
      steps: ["[티스토리 로그인]을 누르고, 카카오 화면에서 '로그인 상태 유지'를 체크한 뒤 로그인하세요.", "로그인 창이 저절로 닫히면 [다시 시도]를 누르세요. 글은 다시 쓰지 않습니다."],
      actions: ["tistoryLogin", retryOrRemake],
    };
  if (has(/네이버 로그인|글쓰기 로그인|세션 만료|로그인이 풀렸/))
    return {
      title: "네이버 로그인이 풀렸습니다",
      steps: ["[네이버 로그인]을 누르고, '로그인 상태 유지'를 체크한 뒤 로그인하세요.", "로그인 창이 저절로 닫히면 [다시 시도]를 누르세요. 글은 다시 쓰지 않습니다."],
      actions: ["naverLogin", retryOrRemake],
    };
  if (has(/hit your .*limit|usage limit|session limit|사용 한도/i))
    return { title: "오늘 AI 사용량을 다 썼습니다", steps: ["몇 시간 뒤(보통 저녁)에 다시 쓸 수 있습니다.", "그때 [다시 시도] 또는 [처음부터 다시 만들기]를 누르세요."], actions: [retryOrRemake] };
  if (has(/claude 실행 실패|ENOENT|AI 프로그램/))
    return { title: "AI 프로그램(claude)을 실행하지 못했습니다", steps: ["검은 창(명령 프롬프트)에서 claude --version 이 나오는지 확인해 주세요.", "안 나오면 Claude 에게 화면을 캡처해 보내주세요."], actions: [] };
  if (has(/Cloudflare/))
    return { title: "AI 그림 열쇠(Cloudflare)가 없습니다", steps: ["사진을 '사진 없음'으로 바꿔 [처음부터 다시 만들기]를 하거나,", "열쇠를 넣은 뒤 앱을 껐다 켜고 다시 시도하세요."], actions: ["remake"] };
  if (has(/전체 중단/))
    return { title: "전체 중단이 켜져 있어 올리지 않았습니다", steps: ["[설정] → 발행 안전장치 → '전체 중단'을 끄세요.", "그다음 [다시 시도]를 누르세요."], actions: ["settings", retryOrRemake] };
  if (has(/오늘 발행 한도/))
    return { title: "오늘 올릴 수 있는 편수를 다 채웠습니다", steps: ["내일 [다시 시도]를 누르면 이 글 그대로 올라갑니다.", "오늘 꼭 올려야 하면 [설정] → 하루 발행 수를 늘리세요."], actions: ["settings", retryOrRemake] };
  if (has(/분 간격|분 지났습니다/))
    return { title: "발행 간격 브레이크에 걸렸습니다", steps: ["안내된 시간이 지난 뒤 [다시 시도]를 누르세요. 글은 그대로입니다."], actions: [retryOrRemake] };
  if (has(/이번 주 티스토리/))
    return { title: "이번 주 티스토리 글 수를 다 채웠습니다", steps: ["다음 주 월요일에 [다시 시도]를 누르세요.", "더 쓰려면 [설정] → 티스토리 → 일주일 글 수를 늘리세요."], actions: ["settings", retryOrRemake] };
  if (has(/게시글 주소로 바뀌지/))
    return {
      title: "발행 버튼은 눌렀지만 올라갔는지 확인하지 못했습니다",
      steps: [
        "⚠️ 먼저 [내 네이버 블로그]를 열어 이 글이 이미 올라갔는지 확인하세요. 올라갔다면 다시 시도하지 마세요(같은 글이 두 번 올라갑니다).",
        "안 올라갔다면 네이버 글쓰기의 '임시저장' 목록에 남아 있을 수 있습니다. 거기서 직접 발행하거나, [다시 시도]를 누르세요.",
      ],
      actions: ["naverBlog", retryOrRemake],
    };
  if (has(/임시저장 버튼은 눌렀지만|저장됐다는 신호/))
    return {
      title: "티스토리에 저장됐는지 확인하지 못했습니다",
      steps: ["[티스토리 글쓰기]를 열고 아래쪽 '임시저장' 옆 숫자를 눌러 이 글이 있는지 보세요.", "있으면 그대로 쓰시면 됩니다. 없을 때만 [다시 시도]를 누르세요."],
      actions: ["tistoryWrite", retryOrRemake],
    };
  if (has(/공개 범위/))
    return {
      title: "공개 범위(비공개/전체공개)를 확인할 수 없어 안전하게 멈췄습니다",
      steps: [
        "네이버 발행 화면이 바뀐 것 같습니다. 잘못 공개되는 것을 막으려고 발행하지 않았습니다.",
        "[다시 시도]를 한 번 눌러 보시고, 또 같은 문구가 나오면 이 화면을 캡처해 Claude 에게 보내주세요.",
        "급하면 [글 복사]로 복사해서 블로그에 직접 붙여넣어 올리세요.",
      ],
      actions: [retryOrRemake],
    };
  if (has(/찾지 못|열지 못|안내창|화면을 가리는|편집기/))
    return {
      title: `${opts.target === "tistory" ? "티스토리" : "네이버"} 글쓰기 화면에서 필요한 칸이나 버튼을 찾지 못했습니다`,
      steps: [
        "잠깐 화면이 늦게 떴을 수 있습니다. [다시 시도]를 한 번 눌러 보세요.",
        "또 실패하면 이 화면을 캡처해 Claude 에게 보내주세요. 그동안은 [글 복사]로 직접 올리실 수 있습니다.",
      ],
      actions: [retryOrRemake],
    };
  if (has(/15분/))
    return { title: "글쓰기 화면 작업이 너무 오래 걸려 멈췄습니다", steps: ["인터넷이 느렸을 수 있습니다. [다시 시도]를 눌러 보세요.", "블로그의 임시저장 목록에 반쯤 쓴 글이 남았을 수 있으니, 다시 시도 전에 지워 두면 깔끔합니다."], actions: [retryOrRemake] };
  if (has(/ERR_|net::|연결하지 못|Timeout|timeout|인터넷/))
    return { title: "인터넷 연결 문제로 실패했습니다", steps: ["인터넷이 되는지 확인한 뒤 [다시 시도]를 누르세요."], actions: [retryOrRemake] };
  if (has(/글감 만들기 실패|본문 쓰기 실패|AI 응답|JSON/))
    return { title: "AI가 글을 끝까지 쓰지 못했습니다", steps: ["가끔 생기는 일입니다. [처음부터 다시 만들기]를 누르세요."], actions: ["remake"] };
  if (has(/사진 폴더/))
    return { title: "내 사진 폴더를 찾지 못했습니다", steps: ["사진 폴더를 다시 고른 뒤 처음부터 다시 만들어 주세요."], actions: ["remake"] };
  return {
    title: "예상하지 못한 문제로 실패했습니다",
    steps: ["[다시 시도]를 한 번 눌러 보세요.", "또 실패하면 이 화면(빨간 글씨 포함)을 캡처해 Claude 에게 보내주세요."],
    actions: [retryOrRemake],
  };
}
