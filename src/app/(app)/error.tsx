"use client";
import Link from "next/link";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

/**
 * Without a boundary at this level, a crash in one page took down the whole app
 * shell (sidebar, navigation and all) and replaced it with a bare full-screen
 * error. Scoping it here keeps the user oriented and one tap from somewhere
 * that works.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ level: "error", scope: "render", digest: error.digest, message: error.message }));
  }, [error]);

  return (
    <div className="app-page">
      <div className="card p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-danger-soft text-danger"><AlertCircle size={24} /></span>
        <h1 className="display mt-6 text-2xl font-bold">This view did not load.</h1>
        <p className="mt-3 leading-7 text-muted">Nothing you saved was affected. You can retry, or move to another part of the app.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button className="btn btn-primary" onClick={reset}><RefreshCw size={17} /> Try again</button>
          <Link className="btn btn-secondary" href="/tasks">Go to your tasks</Link>
        </div>
        {error.digest && <p className="mt-5 text-xs text-muted">Reference: {error.digest}</p>}
      </div>
    </div>
  );
}
