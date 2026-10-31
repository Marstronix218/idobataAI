import { describe, expect, it, vi } from "vitest";
import { detectTimeZone, timeZoneLabel, timeZoneOptions } from "@/lib/domain/time-zones";

describe("time zones", () => {
  it("offers the runtime's full list", () => {
    const zones = timeZoneOptions("America/New_York");

    expect(zones).toEqual(Intl.supportedValuesOf("timeZone"));
    expect(zones.length).toBeGreaterThan(300);
  });

  it("adds a zone the runtime reports but leaves out of its list, in order", () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["America/Chicago", "Europe/London"]);

    expect(timeZoneOptions("UTC")).toEqual(["America/Chicago", "Europe/London", "UTC"]);
    expect(timeZoneOptions("Europe/London")).toEqual(["America/Chicago", "Europe/London"]);
  });

  it("detects the device zone and falls back to UTC", () => {
    const resolvedOptions = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions");
    resolvedOptions.mockReturnValue({ timeZone: "Asia/Tokyo" } as Intl.ResolvedDateTimeFormatOptions);
    expect(detectTimeZone()).toBe("Asia/Tokyo");

    resolvedOptions.mockReturnValue({ timeZone: "" } as Intl.ResolvedDateTimeFormatOptions);
    expect(detectTimeZone()).toBe("UTC");

    resolvedOptions.mockImplementation(() => { throw new RangeError("no zone"); });
    expect(detectTimeZone()).toBe("UTC");
  });

  it("labels zones without underscores", () => {
    expect(timeZoneLabel("America/Los_Angeles")).toBe("America/Los Angeles");
  });
});
