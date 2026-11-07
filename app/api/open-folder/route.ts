import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { paths } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 작업의 사진 폴더(data/images/jobN)를 탐색기/Finder 로 연다. 경로는 job 번호로만 만든다(임의 경로 X). */
export async function POST(req: Request) {
  const job = Number(new URL(req.url).searchParams.get("job"));
  if (!Number.isInteger(job) || job <= 0) return NextResponse.json({ error: "작업 번호가 필요합니다" }, { status: 400 });
  const dir = path.join(paths.images, `job${job}`);
  if (!fs.existsSync(dir)) return NextResponse.json({ error: "이 작업에는 사진이 없습니다" }, { status: 404 });
  const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  try {
    spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();
    return NextResponse.json({ ok: true, path: dir });
  } catch {
    return NextResponse.json({ error: "폴더를 열지 못했습니다", path: dir }, { status: 500 });
  }
}
