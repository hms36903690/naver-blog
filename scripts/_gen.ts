import { generateDraft, generateIdeas, sanitizeDraft } from "@/lib/ai/content";
import { bodyChars } from "@/lib/types";
async function one(kw: string, cat: "tax" | "wage") {
  const t0 = Date.now();
  const ideas = await generateIdeas(kw, [], 5, undefined, "naver", "", cat);
  if (!ideas.ok) return console.log("글감 실패", ideas.error);
  console.log(`\n[${cat}] 추천 제목:\n  ` + ideas.data.map((i) => i.title).join("\n  "));
  const d = await generateDraft(kw, ideas.data[0], [], "none", (w) => console.log("  재시도:", w.slice(0, 90)), "naver", "", cat);
  if (!d.ok) return console.log("본문 실패", d.error);
  const dr = sanitizeDraft(d.data).draft;
  const paras = dr.sections.filter((s) => s.type === "paragraph").map((s: any) => s.text);
  console.log(`  → 쓴 글: ${dr.title} (본문 ${bodyChars(dr)}자, ${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  console.log(`  소제목: ${dr.sections.filter((s) => s.type === "heading" || s.type === "quote").map((s: any) => s.text).join(" | ")}`);
  console.log(`  첫 문단: ${paras[0]}`);
  console.log(`  마지막 문단: ${paras[paras.length - 1]}`);
}
(async () => {
  await one("사업자 세금", "tax");
  await one("사업주 인건비", "wage");
})();
