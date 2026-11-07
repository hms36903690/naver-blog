import { config, hasCloudflare } from "@/config";
import { getDb } from "../db";

export type CfUsage = { neurons: number; measured: boolean; note?: string };

/**
 * 오늘 뉴런 사용량. 실측은 GraphQL aiInferenceAdaptiveGroups (토큰에 Account Analytics: Read 필요).
 * 권한이 없으면 401 이 아니라 "not authorized" GraphQL 에러로 온다 → 자체 기록으로 추정하고 "추정치"라고 표시.
 */
export async function getCfUsageToday(): Promise<CfUsage> {
  const est = (getDb()
    .prepare("SELECT COALESCE(SUM(neurons),0) n FROM cf_usage WHERE date(created_at,'localtime') = date('now','localtime')")
    .get() as { n: number }).n;
  if (!hasCloudflare()) return { neurons: est, measured: false, note: "키 없음" };

  const g = globalThis as unknown as { __cfUsageCache?: { at: number; v: CfUsage } };
  if (g.__cfUsageCache && Date.now() - g.__cfUsageCache.at < 60_000) return g.__cfUsageCache.v;

  // Cloudflare 무료 한도는 UTC 자정 기준으로 리셋된다
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const query = `query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){
    aiInferenceAdaptiveGroups(limit:1000,filter:{datetime_geq:$s,datetime_leq:$e}){sum{totalNeurons}}}}}`;
  let v: CfUsage;
  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.cfApiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { a: config.cfAccountId, s: start.toISOString(), e: new Date().toISOString() } }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json()) as {
      data?: { viewer?: { accounts?: Array<{ aiInferenceAdaptiveGroups?: Array<{ sum?: { totalNeurons?: number } }> }> } };
      errors?: Array<{ message: string }>;
    };
    if (j.errors?.length) v = { neurons: est, measured: false, note: /not authorized/i.test(j.errors[0].message) ? "조회 권한 없음" : "조회 실패" };
    else {
      const groups = j.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
      v = { neurons: groups.reduce((a, g2) => a + (g2.sum?.totalNeurons ?? 0), 0), measured: true };
    }
  } catch {
    v = { neurons: est, measured: false, note: "조회 실패" };
  }
  g.__cfUsageCache = { at: Date.now(), v };
  return v;
}
