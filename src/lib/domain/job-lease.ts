export interface LeaseJob {
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  attempts: number;
  maxAttempts: number;
  availableAt: string | Date;
  leaseExpiresAt?: string | Date | null;
}

function timestamp(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function isJobClaimable(job: LeaseJob, now: Date): boolean {
  if (job.attempts >= job.maxAttempts) return false;
  if (timestamp(job.availableAt)! > now.getTime()) return false;
  if (job.status === "pending" || job.status === "failed") return true;
  return job.status === "processing" && (timestamp(job.leaseExpiresAt) ?? Infinity) <= now.getTime();
}
