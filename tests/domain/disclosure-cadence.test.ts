import { describe, expect, it } from "vitest";
import { AI_DISCLOSURE } from "@/lib/domain/ai-disclosure";
import { readDisclosureMaxGapHours, shouldShowDisclosure } from "@/lib/domain/disclosure-cadence";

const now = new Date("2026-10-31T15:00:00Z"); // 10:00 in Chicago

describe("shouldShowDisclosure", () => {
  it("shows the reminder when it was never shown", () => {
    expect(shouldShowDisclosure({ lastShownAt: null, now, timeZone: "America/Chicago" })).toBe(true);
  });

  it("shows it once per local day", () => {
    expect(shouldShowDisclosure({ lastShownAt: new Date("2026-10-31T13:00:00Z"), now, timeZone: "America/Chicago" })).toBe(false);
    // 03:00Z is 22:00 the previous day in Chicago, but the same day in UTC.
    expect(shouldShowDisclosure({ lastShownAt: new Date("2026-10-31T03:00:00Z"), now, timeZone: "America/Chicago" })).toBe(true);
    expect(shouldShowDisclosure({ lastShownAt: new Date("2026-10-31T03:00:00Z"), now, timeZone: null })).toBe(false);
  });

  it("shows it again after the configured gap", () => {
    const lastShownAt = new Date("2026-10-31T12:00:00Z");
    expect(shouldShowDisclosure({ lastShownAt, now, timeZone: "America/Chicago", maxGapHours: 3 })).toBe(true);
    expect(shouldShowDisclosure({ lastShownAt, now, timeZone: "America/Chicago", maxGapHours: 4 })).toBe(false);
  });

  it("uses the spec's exact wording", () => {
    expect(AI_DISCLOSURE).toBe("AI character · not a person · not a therapist, doctor or lawyer");
  });
});

describe("readDisclosureMaxGapHours", () => {
  it("is off unless set to a positive number", () => {
    expect(readDisclosureMaxGapHours({})).toBeNull();
    expect(readDisclosureMaxGapHours({ AI_DISCLOSURE_MAX_GAP_HOURS: "" })).toBeNull();
    expect(readDisclosureMaxGapHours({ AI_DISCLOSURE_MAX_GAP_HOURS: "0" })).toBeNull();
    expect(readDisclosureMaxGapHours({ AI_DISCLOSURE_MAX_GAP_HOURS: "three" })).toBeNull();
    expect(readDisclosureMaxGapHours({ AI_DISCLOSURE_MAX_GAP_HOURS: "3" })).toBe(3);
  });
});
