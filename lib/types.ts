import { z } from "zod";

// ── 글 섹션 모델 ───────────────────────────────────────────────
export const HeadingSec = z.object({ type: z.literal("heading"), text: z.string().min(1) });
export const ParagraphSec = z.object({
  type: z.literal("paragraph"),
  text: z.string().min(1),
  // text 안에 글자 그대로 있어야 하는 핵심 구절 → 형광펜(노랑)+굵게
  highlight: z.string().nullish(),
});
export const QuoteSec = z.object({ type: z.literal("quote"), text: z.string().min(1) });
export const DividerSec = z.object({ type: z.literal("divider") });
export const ImageSec = z.object({ type: z.literal("image"), query: z.string().min(1), caption: z.string().nullish() });

export const Section = z.discriminatedUnion("type", [HeadingSec, ParagraphSec, QuoteSec, DividerSec, ImageSec]);
export type Section = z.infer<typeof Section>;

export const DraftBase = z.object({ title: z.string().min(2), sections: z.array(Section).min(3) });
export type Draft = z.infer<typeof DraftBase>;

export type PhotoSource = "local" | "crawl" | "ai" | "none";
export type ImageStyle = "photo" | "illust";
export type Mode = "auto" | "review" | "branding";
/** 올릴 곳. 티스토리는 "임시저장까지만"(반자동) — 발행은 사람이 직접 한다. */
export type Target = "naver" | "tistory";

const countImages = (d: Draft) => d.sections.filter((s) => s.type === "image").length;

/**
 * ⚠️ 이미지 자리 개수 refine 은 사진 소스별로 분기한다.
 * local 에 "6개 이상"을 걸면 사진이 4장뿐일 때 애초에 만들 수 없어 재시도만 3번 돌다 실패한다.
 * (highlight 는 여기서 반려 사유로 쓰지 않는다 → sanitizeDraft 에서 개별로 떨어뜨림, 7-24)
 */
export function draftSchemaFor(photoSource: PhotoSource, localCount = 0) {
  if (photoSource === "none")
    return DraftBase.refine((d) => countImages(d) === 0, { message: "사진 없음 모드인데 image 섹션이 있습니다. image 섹션을 빼세요." });
  if (photoSource === "local")
    return DraftBase.refine((d) => countImages(d) === localCount, {
      message: `image 섹션이 정확히 ${localCount}개여야 합니다.`,
    });
  return DraftBase.refine((d) => countImages(d) >= 6, { message: "image 섹션이 6개 이상이어야 합니다." });
}

// ── 글감 ──────────────────────────────────────────────────────
export const Idea = z.object({ title: z.string().min(2), angle: z.string(), rationale: z.string() });
export type Idea = z.infer<typeof Idea>;
export const IdeaList = z.array(Idea).min(1);

// ── 비전 판정 ─────────────────────────────────────────────────
export const CrawlVerdict = z.object({
  fit: z.boolean(),
  watermark: z.boolean(),
  koreanPerson: z.boolean(),
  reason: z.string(),
});
export type CrawlVerdict = z.infer<typeof CrawlVerdict>;

export const GenVerdict = z.object({
  ok: z.boolean(),
  offTopic: z.boolean(),
  deformed: z.boolean(),
  hasText: z.boolean(),
  lowQuality: z.boolean(),
  reason: z.string(),
});
export type GenVerdict = z.infer<typeof GenVerdict>;

export const PromptDesign = z.object({ prompt: z.string().min(10) });

// ── 수집 자료 ─────────────────────────────────────────────────
export type Source = { type: "news" | "blog"; title: string; summary: string; url: string };

// ── 잡 입력 ───────────────────────────────────────────────────
export const JobInput = z.object({
  mode: z.enum(["auto", "review", "branding"]),
  keyword: z.string().trim().min(1, "주제(키워드)를 입력하세요").max(200),
  details: z.string().max(5000).optional().default(""),
  photoSource: z.enum(["local", "crawl", "ai", "none"]),
  imageStyle: z.enum(["photo", "illust"]).optional().default("photo"),
  photoFolder: z.string().optional().default(""),
  photoPlacement: z.enum(["order", "ai"]).optional().default("ai"),
  target: z.enum(["naver", "tistory"]).optional().default("naver"),
  /** [제목 추천]에서 사람이 고른 글감. 있으면 자동 발굴의 "1등 자동 선택"을 건너뛴다. */
  idea: z.object({ title: z.string().min(2).max(200), angle: z.string().max(500), rationale: z.string().max(800) }).optional(),
  /** 제목 추천 때 모은 자료(다시 긁지 않도록 그대로 넘긴다) */
  sources: z
    .array(z.object({ type: z.enum(["news", "blog"]), title: z.string().max(300), summary: z.string().max(400), url: z.string().max(1000) }))
    .max(60)
    .optional(),
});
export type JobInput = z.infer<typeof JobInput>;
