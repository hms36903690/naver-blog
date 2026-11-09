import { z } from "zod";
import { runClaudeJson } from "../claude";
import { updateSettings } from "../settings";

export type RssPost = { title: string; category: string; text: string; date: string };

const decode = (t: string) =>
  t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/** HTML → 구조가 보이는 텍스트(소제목·목록·표·인용 표시를 남겨 AI 가 "구성"도 볼 수 있게) */
export function htmlToOutline(html: string): string {
  return decode(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<h([1-4])[^>]*>/gi, (_m, n) => `\n[H${n}] `)
    .replace(/<blockquote[^>]*>/gi, "\n[인용] ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<table[^>]*>/gi, "\n[표]\n")
    .replace(/<img[^>]*>/gi, "\n[사진]\n")
    .replace(/<hr[^>]*>/gi, "\n[구분선]\n")
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** 티스토리 RSS(/rss)에서 최근 글. 셀렉터 없이 표준 RSS 태그만 쓴다. */
export function parseRss(xml: string, max = 8): RssPost[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [];
  const pick = (it: string, tag: string) => {
    const m = it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return m ? decode(m[1]).trim() : "";
  };
  return items.slice(0, max).map((it) => ({
    title: pick(it, "title"),
    category: pick(it, "category"),
    date: pick(it, "pubDate"),
    text: htmlToOutline(pick(it, "description")),
  }));
}

export async function fetchTistoryPosts(blog: string): Promise<RssPost[]> {
  const res = await fetch(`https://${blog}.tistory.com/rss`, {
    headers: { "User-Agent": "Mozilla/5.0 (blog-style-reader)", Accept: "application/rss+xml, text/xml" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`블로그 글 목록을 가져오지 못했습니다(HTTP ${res.status}). 주소를 확인해 주세요.`);
  const posts = parseRss(await res.text());
  if (!posts.length) throw new Error("블로그에서 글을 찾지 못했습니다. 공개된 글이 있는지, RSS 가 켜져 있는지 확인해 주세요.");
  return posts;
}

const StyleOut = z.object({
  topics: z.array(z.string()).max(10),
  guide: z.string().min(20),
});

/**
 * 최근 글을 읽고 "이 블로그의 글투 안내"를 만든다. 문장을 베끼는 용도가 아니라 말투·구성·분량을 맞추기 위함.
 * 결과는 설정(tistoryStyle)에 저장되고, 사람이 설정 화면에서 고칠 수 있다.
 */
export async function learnTistoryStyle(blog: string): Promise<{ guide: string; topics: string[]; posts: number }> {
  const posts = await fetchTistoryPosts(blog);
  const sample = posts
    .map((p, i) => `### 글 ${i + 1}: ${p.title}${p.category ? ` (카테고리: ${p.category})` : ""}\n${p.text.slice(0, 1600)}`)
    .join("\n\n");
  const prompt = `
아래는 한 티스토리 블로그의 최근 글 ${posts.length}편이다([H2]=소제목, [사진], [표], [인용], - 목록 표시 포함).
이 블로그 주인이 새 글을 쓸 때 AI 가 따라야 할 "글투 안내"를 만들어라.

포함할 것(구체적으로, 실제 관찰한 것만):
- 주로 다루는 주제와 독자
- 말투(예: ~요체/~습니다체, 1인칭 사용, 감탄·이모지 사용 정도)
- 글 구성 순서(도입 방식, 목차·요약 상자·표·체크리스트 사용 여부, 소제목 개수와 스타일, 마무리 방식)
- 글 길이와 문단 길이
- 반복되는 고정 문구가 있으면 그 "종류"만(예: 광고 고지 문구가 맨 위에 있다). 문구를 통째로 옮기지는 마라.
- 피해야 할 것(이 블로그에 없는 스타일)

출력(JSON): {"topics": ["주제1", ...], "guide": "- 로 시작하는 8~14줄 안내"}

${sample}
`.trim();
  const r = await runClaudeJson(prompt, StyleOut, { retries: 1 });
  if (!r.ok) throw new Error(`글투 분석 실패: ${r.error.slice(0, 160)}`);
  const guide = `${r.data.topics.length ? `- 주요 주제: ${r.data.topics.join(", ")}\n` : ""}${r.data.guide.trim()}`;
  updateSettings({ tistoryStyle: guide });
  return { guide, topics: r.data.topics, posts: posts.length };
}
