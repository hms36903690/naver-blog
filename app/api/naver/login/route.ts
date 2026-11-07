import { NextResponse } from "next/server";
import { loginInteractive, verifySession } from "@/lib/naver/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST() {
  const r = await loginInteractive();
  if (!r.ok) return NextResponse.json(r, { status: 400 });
  const session = await verifySession(true);
  return NextResponse.json({ ...r, session });
}
