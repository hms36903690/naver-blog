import { NextResponse } from "next/server";
import { tistoryLogout } from "@/lib/tistory/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  tistoryLogout();
  return NextResponse.json({ ok: true });
}
