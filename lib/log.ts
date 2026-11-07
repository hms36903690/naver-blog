import { getDb } from "./db";

export type LogLevel = "info" | "warn" | "error" | "ok";

export function jobLog(jobId: number, message: string, level: LogLevel = "info") {
  getDb().prepare("INSERT INTO job_logs (job_id, level, message) VALUES (?,?,?)").run(jobId, level, message);
  const tag = level === "error" ? "✖" : level === "warn" ? "!" : level === "ok" ? "✔" : "·";
  console.log(`[job ${jobId}] ${tag} ${message}`);
}
