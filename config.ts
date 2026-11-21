// 전역 기본값. 환경변수는 "최초 기본값"으로만 쓰이고, 이후엔 DB(settings 테이블) 값이 우선한다.
import { loadDataEnv } from "./lib/paths";

// 열쇠 파일은 데이터 폴더(사용자 폴더/naver-blog-data/.env.local)에 둔다 — 새 버전 폴더에서도 그대로 읽힌다.
loadDataEnv();
const env = (k: string) => process.env[k];
const num = (k: string, d: number) => {
  const v = Number(env(k));
  return Number.isFinite(v) && env(k) !== undefined && env(k) !== "" ? v : d;
};
const bool = (k: string, d: boolean) => {
  const v = env(k);
  if (v === undefined || v === "") return d;
  return /^(1|true|yes|on)$/i.test(v);
};

export const config = {
  port: 4123,
  claudeBin: env("CLAUDE_BIN") || "claude",
  cfAccountId: env("CLOUDFLARE_ACCOUNT_ID") || "",
  cfApiToken: env("CLOUDFLARE_API_TOKEN") || "",
  cfModel: "@cf/black-forest-labs/flux-1-schnell",
  cfDailyFreeNeurons: 10_000,
  defaults: {
    dryRun: bool("DRY_RUN", true),
    killSwitch: bool("KILL_SWITCH", false),
    visibility: (env("VISIBILITY") as "public" | "neighbor" | "both" | "private") || "private",
    dailyPublishLimit: num("DAILY_PUBLISH_LIMIT", 3),
    minPublishIntervalMin: num("MIN_PUBLISH_INTERVAL_MIN", 30),
    scrapeTopN: num("SCRAPE_TOP_N", 8),
    imageCandidates: num("IMAGE_CANDIDATES", 10),
    cfImageSteps: num("CF_IMAGE_STEPS", 6),
    showBrowser: bool("SHOW_BROWSER", false),
    claudeTimeoutSec: num("CLAUDE_TIMEOUT_SEC", 180),
    claudeConcurrency: num("CLAUDE_CONCURRENCY", 2),
    tistoryBlog: env("TISTORY_BLOG") || "",
    tistoryStyle: "",
    tistoryWeeklyLimit: num("TISTORY_WEEKLY_LIMIT", 3),
    naverCtaText: "우리 가게 상황에 맞는 세금·인건비·임대료 정리가 궁금하신가요? 아래에서 무료 상담을 신청하시면 상황을 듣고 필요한 정보를 정리해 드리고, 신고·대리가 필요한 부분은 세무사·노무사와 연결해 드립니다.",
    naverCtaUrl: "",
    naverAuthorBio: "",
  },
};

export const hasCloudflare = () => Boolean(config.cfAccountId && config.cfApiToken);
