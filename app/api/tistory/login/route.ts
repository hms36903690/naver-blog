import { NextResponse } from "next/server";
import { tistoryLogin, verifyTistory } from "@/lib/tistory/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST() {
  const r = await tistoryLogin();
  if (!r.ok) return NextResponse.json(r, { status: 400 });
  return NextResponse.json({ ...r, session: await verifyTistory(true) });
}
