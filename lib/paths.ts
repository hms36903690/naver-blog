import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 로컬 데이터(DB·로그인 정보·사진·스크린샷·열쇠 파일)는 앱 폴더 "바깥"의 고정된 자리에 둔다:
 *   기본 = 사용자 폴더/naver-blog-data  (예: C:\Users\사용자\naver-blog-data)
 * 이유: 사용자는 새 버전을 "압축 풀고 start 누르기"로 쓴다. 데이터가 앱 폴더 안(./data)에 있으면
 *   새로 푼 폴더마다 로그인·글투·열쇠가 사라진다(실제 요청).
 * DATA_DIR 은 테스트·개발에서 임시 폴더를 쓰기 위한 것.
 */
export const dataRoot = path.resolve(process.env.DATA_DIR || path.join(os.homedir(), "naver-blog-data"));
export const keysFile = path.join(dataRoot, ".env.local");

export const paths = {
  root: dataRoot,
  db: path.join(dataRoot, "app.db"),
  session: path.join(dataRoot, "naver-session.json"),
  images: path.join(dataRoot, "images"),
  screenshots: path.join(dataRoot, "screenshots"),
  debug: path.join(dataRoot, "debug"),
};

/**
 * 예전 버전은 앱 폴더 안 ./data 와 ./.env.local 을 썼다. 새 자리에 아직 아무것도 없으면 한 번 복사해 온다(원본은 남긴다).
 * 사용자는 새 버전을 "다른 곳에 압축 풀고 start" 하므로, 현재 폴더뿐 아니라 바탕화면·다운로드·문서에서
 * 예전 앱 폴더(package.json 이름이 naver-blog-auto 이고 data/app.db 가 있는 곳)를 찾아 가장 최근 것을 쓴다.
 */
function findLegacyAppDirs(): string[] {
  const home = os.homedir();
  const roots = [
    process.cwd(),
    path.join(home, "Desktop"),
    path.join(home, "OneDrive", "Desktop"),
    path.join(home, "OneDrive", "바탕 화면"),
    path.join(home, "Downloads"),
    path.join(home, "Documents"),
  ];
  const found: Array<{ dir: string; mtime: number }> = [];
  const isApp = (d: string) => {
    try {
      const db = path.join(d, "data", "app.db");
      if (!fs.existsSync(db)) return;
      const pkg = JSON.parse(fs.readFileSync(path.join(d, "package.json"), "utf8"));
      if (pkg.name === "naver-blog-auto") found.push({ dir: d, mtime: fs.statSync(db).mtimeMs });
    } catch {
      /* 앱 폴더 아님 */
    }
  };
  const walk = (d: string, depth: number) => {
    isApp(d);
    if (depth <= 0) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules" || e.name === "data") continue;
      walk(path.join(d, e.name), depth - 1);
    }
  };
  for (const r of roots) if (fs.existsSync(r)) walk(r, r === process.cwd() ? 0 : 3);
  return found.sort((a, b) => b.mtime - a.mtime).map((f) => f.dir);
}

let migrated = false;
function migrateLegacy() {
  if (migrated || process.env.DATA_DIR) return;
  migrated = true;
  try {
    const needData = !fs.existsSync(path.join(dataRoot, "app.db"));
    const needKeys = !fs.existsSync(keysFile);
    if (!needData && !needKeys) return;
    const dirs = findLegacyAppDirs();
    if (needData && dirs[0]) {
      fs.mkdirSync(dataRoot, { recursive: true });
      fs.cpSync(path.join(dirs[0], "data"), dataRoot, { recursive: true, force: false, errorOnExist: false });
      console.log(`[data] 예전 앱 폴더(${dirs[0]})의 data 를 ${dataRoot} 로 복사했습니다`);
    }
    if (needKeys) {
      const src = [process.cwd(), ...dirs].map((d) => path.join(d, ".env.local")).find((f) => fs.existsSync(f));
      if (src) {
        fs.mkdirSync(dataRoot, { recursive: true });
        fs.copyFileSync(src, keysFile);
        console.log(`[data] 열쇠 파일을 ${keysFile} 로 복사했습니다`);
      }
    }
  } catch (e) {
    console.error("[data] 예전 데이터 복사 실패:", (e as Error).message);
  }
}

/** 데이터 폴더의 .env.local(열쇠 파일)을 읽어 아직 없는 환경변수만 채운다. 앱 폴더의 .env.local 이 있으면 Next 가 먼저 읽는다. */
export function loadDataEnv() {
  migrateLegacy();
  if (!fs.existsSync(keysFile)) return;
  for (const line of fs.readFileSync(keysFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (v && !process.env[m[1]]) process.env[m[1]] = v;
  }
}

let ensured = false;
export function ensureDirs() {
  if (ensured) return;
  migrateLegacy();
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
