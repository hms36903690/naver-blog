import { execFile } from "node:child_process";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;

/**
 * ⚠️ 7-14: <input webkitdirectory> 는 보안상 상대 경로만 준다 → Playwright 업로드에 못 쓴다.
 * 로컬 전용 앱이므로 백엔드에서 OS 네이티브 폴더 선택창을 띄운다. 2분 타임아웃 필수(방치하면 요청이 영원히 안 끝남).
 * 취소 판정: macOS 는 stderr 의 "User canceled", 윈도우는 stdout 이 빈 것.
 */
function run(cmd: string, args: string[]): Promise<{ out: string; err: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const p = execFile(cmd, args, { timeout: 120_000, windowsHide: false, encoding: "utf8" }, (error, stdout, stderr) => {
      const e = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      resolve({ out: String(stdout || ""), err: String(stderr || e?.message || ""), code: typeof e?.code === "number" ? e.code : e ? 1 : 0, timedOut: Boolean(e?.killed) });
    });
    p.on("error", () => {});
  });
}

const trimSep = (p: string) => p.trim().replace(/[\\/]+$/, "");

export async function POST() {
  if (process.platform === "darwin") {
    const r = await run("osascript", ["-e", 'POSIX path of (choose folder with prompt "블로그에 쓸 사진 폴더를 고르세요")']);
    if (r.timedOut) return NextResponse.json({ canceled: true, message: "2분 동안 선택이 없어 닫았습니다" });
    if (/User canceled|-128/.test(r.err)) return NextResponse.json({ canceled: true });
    if (!r.out.trim()) return NextResponse.json({ error: "폴더 선택창을 열지 못했습니다. 경로를 직접 입력해 주세요." }, { status: 500 });
    return NextResponse.json({ path: trimSep(r.out) });
  }
  if (process.platform === "win32") {
    // ⚠️ -STA 필수 — WinForms 대화상자는 STA 아파트먼트에서만 뜬다. (윈도우 동작은 미검증)
    const ps =
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; " +
      "$f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = '블로그에 쓸 사진 폴더를 고르세요'; " +
      "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }";
    const r = await run("powershell", ["-NoProfile", "-STA", "-Command", ps]);
    if (r.timedOut) return NextResponse.json({ canceled: true, message: "2분 동안 선택이 없어 닫았습니다" });
    if (!r.out.trim()) return NextResponse.json({ canceled: true });
    return NextResponse.json({ path: trimSep(r.out) });
  }
  return NextResponse.json({ error: "이 컴퓨터에서는 폴더 선택창을 띄울 수 없습니다. 경로를 직접 입력해 주세요." }, { status: 501 });
}
