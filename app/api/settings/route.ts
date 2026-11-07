import { NextResponse } from "next/server";
import { getSettings, LIMITS, resetSettings, UnknownSettingError, updateSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: getSettings(), limits: LIMITS });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 잘못됐습니다" }, { status: 400 });
  }
  if (body.reset === true) return NextResponse.json({ settings: resetSettings(), limits: LIMITS });
  try {
    return NextResponse.json({ settings: updateSettings(body), limits: LIMITS });
  } catch (e) {
    if (e instanceof UnknownSettingError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
