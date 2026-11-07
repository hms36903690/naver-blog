import { NextResponse } from "next/server";
import { hasCloudflare } from "@/config";
import { checkClaude } from "@/lib/claude";
import { hasSessionFile, invalidateSessionCache, isLoginInFlight, verifySession } from "@/lib/naver/session";
import { getSettings, LIMITS } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("refresh") === "1") invalidateSessionCache();
  const [claude, naver] = await Promise.all([
    checkClaude(),
    hasSessionFile() ? verifySession() : Promise.resolve({ state: "none" as const, message: "로그인 정보가 없습니다." }),
  ]);
  return NextResponse.json({
    claude,
    naver: { ...naver, loginInFlight: isLoginInFlight() },
    cloudflare: { configured: hasCloudflare() },
    settings: getSettings(),
    limits: LIMITS,
    platform: process.platform,
  });
}
