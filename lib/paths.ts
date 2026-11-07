import fs from "node:fs";
import path from "node:path";

// 모든 로컬 데이터는 ./data 아래에 둔다(완전 로컬).
// DATA_DIR 은 테스트에서 임시 폴더를 쓰기 위한 것.
export const dataRoot = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));

export const paths = {
  root: dataRoot,
  db: path.join(dataRoot, "app.db"),
  session: path.join(dataRoot, "naver-session.json"),
  images: path.join(dataRoot, "images"),
  screenshots: path.join(dataRoot, "screenshots"),
  debug: path.join(dataRoot, "debug"),
};

let ensured = false;
export function ensureDirs() {
  if (ensured) return;
  for (const d of [paths.root, paths.images, paths.screenshots, paths.debug]) {
    fs.mkdirSync(d, { recursive: true });
  }
  ensured = true;
}

/**
 * ⚠️ 7-23: macOS 의 process.cwd() 는 한글을 NFD(자모 분해)로, 브라우저 URL 파라미터는 NFC(완성형)로 준다.
 * 같은 폴더인데 startsWith 가 false → 한글 경로에서 모든 이미지 미리보기가 403.
 * 비교 전 양쪽을 NFC 로. 윈도우는 대소문자도 무시(C:\Users vs c:\users).
 */
export const normPath = (x: string) => {
  const n = path.resolve(x).normalize("NFC");
  return process.platform === "win32" ? n.toLowerCase() : n;
};

/** data 폴더 안의 파일인지(경로 탈출 방지). */
export function isInsideData(p: string): boolean {
  const root = normPath(dataRoot);
  const target = normPath(p);
  return target.startsWith(root + path.sep);
}

export function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return path.join(home, p.slice(1));
  }
  return p;
}
