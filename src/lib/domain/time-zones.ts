/** The browser's IANA time zone, or UTC when the runtime cannot say. */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Zones to offer in a picker, always including `current`: runtimes may report
 * a zone that their own list leaves out (for example "UTC", or an older alias
 * such as "Asia/Calcutta").
 */
export function timeZoneOptions(current: string): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes(current) ? zones : [...zones, current].sort();
}

export const timeZoneLabel = (zone: string) => zone.replaceAll("_", " ");
