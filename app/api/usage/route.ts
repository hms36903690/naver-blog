import { NextResponse } from "next/server";
import { getCfUsageToday } from "@/lib/ai/cfUsage";
import { FREE_DAILY_NEURONS, neuronsPerImage } from "@/lib/ai/neurons";
import { countPublishedToday, countTistoryDraftsThisWeek, lastPublishedAt } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = getSettings();
  const cf = await getCfUsageToday();
  const last = lastPublishedAt();
  return NextResponse.json({
    publishedToday: countPublishedToday(),
    dailyLimit: s.dailyPublishLimit,
    minIntervalMin: s.minPublishIntervalMin,
    lastPublishedAt: last?.toISOString() ?? null,
    neurons: cf.neurons,
    neuronsMeasured: cf.measured,
    neuronsNote: cf.note ?? null,
    neuronsLimit: FREE_DAILY_NEURONS,
    perImage: neuronsPerImage(s.cfImageSteps),
    tistoryThisWeek: countTistoryDraftsThisWeek(),
    tistoryWeeklyLimit: s.tistoryWeeklyLimit,
  });
}
