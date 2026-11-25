/**
 * 파일 "내용"으로 실제 이미지 형식을 알아낸다(이름·content-type 을 믿지 않는다).
 * ⚠️ 티스토리 공지(2026-12-26 시행): "파일 이름(확장자)만 바꾼 경우에도 실제 파일 형식을 확인해 업로드를 제한".
 *   예전 앱은 Cloudflare 가 준 JPEG 를 무조건 .png 로 저장했다 → 이름과 형식이 달라 막힐 수 있었다.
 */
export type ImgKind = "jpg" | "png" | "webp" | "gif" | "heic" | "avif" | "unknown";

export function detectImage(buf: Buffer): ImgKind {
  if (buf.length < 12) return "unknown";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 4) === "GIF8") return "gif";
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (/avif|avis/.test(brand)) return "avif";
    if (/heic|heix|hevc|mif1|msf1/.test(brand)) return "heic";
  }
  return "unknown";
}

export const extFor = (k: ImgKind) => (k === "unknown" ? ".jpg" : `.${k}`);
export const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic", ".avif": "image/avif",
};
/** 블로그 웹 글쓰기에서 거절될 수 있는 형식(티스토리 공지: HEIC 등은 JPG 로 바꿔 올리라) */
export const needsConversion = (k: ImgKind) => k === "heic" || k === "avif" || k === "unknown";
