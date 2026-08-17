"use client";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // The error prop used to be discarded entirely, so a render crash left no
  // diagnostic trail at all. The digest is what correlates this screen with the
  // server-side log line.
  useEffect(() => {
    console.error(JSON.stringify({ level: "error", scope: "render", digest: error.digest, message: error.message }));
  }, [error]);

  return <main id="main-content" className="grid min-h-screen place-items-center px-5"><div className="card max-w-md p-8 text-center"><span className="ring-mark mx-auto grid h-14 w-14 place-items-center rounded-full bg-danger-soft text-danger"><AlertCircle size={24} /></span><h1 className="display mt-6 text-3xl font-bold">We lost the thread.</h1><p className="mt-3 leading-7 text-muted">Your last successful action is safe. Try loading this view again.</p><button className="btn btn-primary mt-6" onClick={reset}><RefreshCw size={17} /> Try again</button>{error.digest && <p className="mt-5 text-xs text-muted">Reference: {error.digest}</p>}</div></main>;
}
