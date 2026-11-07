import fs from "node:fs";
import path from "node:path";
import { isInsideData } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
};

/** ./data 내부 파일만 서빙. 경로 탈출 방지(resolve 후 접두사 검사) + NFC 정규화(7-23). */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get("path");
  if (!p) return new Response("path 가 필요합니다", { status: 400 });
  const abs = path.resolve(p);
  if (!isInsideData(abs)) return new Response("허용되지 않은 경로", { status: 403 });
  // 디스크 실제 이름이 NFD 일 수 있으니 원본 → NFC → NFD 순으로 찾는다
  const candidates = [abs, abs.normalize("NFC"), abs.normalize("NFD")];
  const found = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!found) return new Response("없음", { status: 404 });
  const type = TYPES[path.extname(found).toLowerCase()] || "application/octet-stream";
  return new Response(new Uint8Array(fs.readFileSync(found)), { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}
