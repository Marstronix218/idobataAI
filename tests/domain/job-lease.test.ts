import { describe, expect, it } from "vitest";

import { isJobClaimable } from "@/lib/domain/job-lease";

type Job = Parameters<typeof isJobClaimable>[0];
type Now = Parameters<typeof isJobClaimable>[1];

const now = new Date("2026-08-12T12:00:00.000Z") as Now;

const pendingJob = {
  status: "pending",
  attempts: 0,
  maxAttempts: 3,
  availableAt: "2026-08-12T11:00:00.000Z",
  leaseExpiresAt: null,
} as unknown as Job;

describe("isJobClaimable", () => {
  it("allows a pending job without a lease", () => {
    expect(isJobClaimable(pendingJob, now)).toBe(true);
  });

  it("rejects a processing job with an active lease", () => {
    const leased = {
      ...pendingJob,
      status: "processing",
      leaseExpiresAt: "2026-08-12T12:05:00.000Z",
    } as unknown as Job;

    expect(isJobClaimable(leased, now)).toBe(false);
  });

  it("allows a processing job after its lease expires", () => {
    const expired = {
      ...pendingJob,
      status: "processing",
      leaseExpiresAt: "2026-08-12T11:59:59.000Z",
    } as unknown as Job;

    expect(isJobClaimable(expired, now)).toBe(true);
  });

  it("allows a processing job exactly when its lease expires", () => {
    const expired = {
      ...pendingJob,
      status: "processing",
      leaseExpiresAt: "2026-08-12T12:00:00.000Z",
    } as unknown as Job;

    expect(isJobClaimable(expired, now)).toBe(true);
  });

  it("rejects a job during its retry cooldown", () => {
    const coolingDown = {
      ...pendingJob,
      availableAt: "2026-08-12T12:01:00.000Z",
    } as unknown as Job;

    expect(isJobClaimable(coolingDown, now)).toBe(false);
  });

  it("rejects a job at the retry limit", () => {
    const exhausted = {
      ...pendingJob,
      attempts: 3,
    } as unknown as Job;

    expect(isJobClaimable(exhausted, now)).toBe(false);
  });

  it("allows a failed job after its cooldown", () => {
    const retryable = {
      ...pendingJob,
      status: "failed",
      attempts: 1,
      availableAt: "2026-08-12T12:00:00.000Z",
    } as unknown as Job;

    expect(isJobClaimable(retryable, now)).toBe(true);
  });

  it("rejects a completed job", () => {
    const completed = {
      ...pendingJob,
      status: "completed",
    } as unknown as Job;

    expect(isJobClaimable(completed, now)).toBe(false);
  });
});
