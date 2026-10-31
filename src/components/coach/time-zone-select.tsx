"use client";

import { useMemo } from "react";
import { timeZoneLabel, timeZoneOptions } from "@/lib/domain/time-zones";

export function TimeZoneSelect({ id, value, onChange, disabled = false }: {
  id: string;
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
}) {
  const zones = useMemo(() => timeZoneOptions(value), [value]);
  return <select id={id} className="field" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
    {zones.map((zone) => <option key={zone} value={zone}>{timeZoneLabel(zone)}</option>)}
  </select>;
}
