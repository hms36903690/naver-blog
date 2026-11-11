import { NextResponse } from "next/server";
import { hasCloudflare } from "@/config";
import { checkClaude } from "@/lib/claude";
import { hasSessionFile, invalidateSessionCache, isLoginInFlight, verifySession } from "@/lib/naver/session";
import { dataRoot } from "@/lib/paths";
import { getSettings, LIMITS } from "@/lib/settings";
import { invalidateTistoryCache, isTistoryLoginInFlight, verifyTistory } from "@/lib/tistory/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("refresh") === "1") {
    invalidateSessionCache();
    invalidateTistoryCache();
  }
  const [claude, naver, tistory] = await Promise.all([
    checkClaude(),
    hasSessionFile() ? verifySession() : Promise.resolve({ state: "none" as const, message: "로그인 정보가 없습니다." }),
    verifyTistory(),
  ]);
  return NextResponse.json({
    claude,
    naver: { ...naver, loginInFlight: isLoginInFlight() },
    tistory: { ...tistory, loginInFlight: isTistoryLoginInFlight() },
    cloudflare: { configured: hasCloudflare() },
    settings: getSettings(),
    limits: LIMITS,
    platform: process.platform,
    dataRoot,
  });
}
