import { ACTIVE_STATUSES, getDb, type JobStatus } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SSE: job_logs 를 1초 폴링해 새 줄만 전송. 잡이 끝나면 end 를 보내고 닫는다. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const url = new URL(req.url);
  let lastId = Number(url.searchParams.get("after") || 0);
  const db = getDb();
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const tick = () => {
        if (closed) return;
        try {
          const rows = db
            .prepare("SELECT id, level, message, created_at FROM job_logs WHERE job_id=? AND id>? ORDER BY id")
            .all(id, lastId) as Array<{ id: number }>;
          for (const r of rows) {
            send("log", r);
            lastId = r.id;
          }
          const job = db.prepare("SELECT status, stage FROM jobs WHERE id=?").get(id) as { status: JobStatus; stage: string } | undefined;
          if (!job) {
            send("end", { status: "missing" });
            return close();
          }
          send("stage", job);
          if (!ACTIVE_STATUSES.includes(job.status)) {
            send("end", job);
            return close();
          }
        } catch (e) {
          send("error", { message: (e as Error).message });
        }
        timer = setTimeout(tick, 1000);
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", close);
      tick();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
