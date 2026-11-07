import { spawn } from "node:child_process";
import fs from "node:fs";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { paths } from "./paths";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

// 설치 Promise 를 모듈 레벨(globalThis)에 캐싱해 동시에 여러 번 설치하지 않게 한다.
const g = globalThis as unknown as { __pwInstall?: Promise<void> };

function installChromium(): Promise<void> {
  return (g.__pwInstall ??= new Promise<void>((resolve, reject) => {
    console.log("[playwright] chromium 이 없어 자동 설치합니다 (1~3분)…");
    // 윈도우 npx.cmd 셸 심 — 셸이 필요하고, DEP0190 경고를 피하려 한 줄 명령으로 넘긴다
    const p =
      process.platform === "win32"
        ? spawn("npx playwright install chromium", { shell: true, stdio: "inherit" })
        : spawn("npx", ["playwright", "install", "chromium"], { stdio: "inherit" });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`playwright install 실패 (${code})`))));
  }).catch((e) => {
    g.__pwInstall = undefined;
    throw e;
  }));
}

async function launch(headless: boolean): Promise<Browser> {
  const exe = process.env.PW_CHROMIUM_PATH;
  try {
    return await chromium.launch({ headless, ...(exe ? { executablePath: exe } : {}) });
  } catch (e) {
    const msg = (e as Error).message || "";
    if (/Executable doesn'?t exist|please run|install/i.test(msg)) {
      await installChromium();
      return chromium.launch({ headless });
    }
    throw e;
  }
}

/** 임의의 storageState 파일(티스토리 등)을 입히는 범용 컨텍스트 */
export async function newContextWith(opts: { headless: boolean; storageState?: string }): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  const browser = await launch(opts.headless);
  const storageState = opts.storageState && fs.existsSync(opts.storageState) ? opts.storageState : undefined;
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "ko-KR", userAgent: UA, storageState });
  return { browser, context };
}

export async function newContext(opts: { headless: boolean; useNaverSession: boolean }): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  const browser = await launch(opts.headless);
  const storageState = opts.useNaverSession && fs.existsSync(paths.session) ? paths.session : undefined;
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "ko-KR",
    userAgent: UA,
    storageState,
  });
  return { browser, context };
}
