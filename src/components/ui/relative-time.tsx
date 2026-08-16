"use client";

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let currentTime = Date.now();
let clock: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  currentTime = Date.now();
  listener();
  if (clock === null) {
    clock = setInterval(() => {
      currentTime = Date.now();
      listeners.forEach((notify) => notify());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && clock !== null) {
      clearInterval(clock);
      clock = null;
    }
  };
}

const getClientTime = () => currentTime;
const getServerTime = () => null;

export function formatRelativeTime(value: string, now: number) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "recently";

  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1_440)}d ago`;
}

export function RelativeTime({ value }: { value: string }) {
  const now = useSyncExternalStore<number | null>(subscribe, getClientTime, getServerTime);

  return (
    <time dateTime={now === null ? undefined : value}>
      {now === null ? "recently" : formatRelativeTime(value, now)}
    </time>
  );
}
