"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, isPreviewMode } from "@/lib/client/api";

export default function AuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");
  const missingCode = !params.get("code");

  useEffect(() => {
    if (isPreviewMode) { router.replace("/feed"); return; }
    const code = params.get("code");
    const requested = params.get("next") ?? "/feed";
    const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/feed";
    if (!code) return;
    createClient().auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
      if (exchangeError) setError(exchangeError.message);
      else { router.replace(next); router.refresh(); }
    }).catch((reason) => setError(errorMessage(reason)));
  }, [params, router]);

  const displayedError = error || (missingCode ? "The sign-in link is missing its authorization code." : "");
  return <main id="main-content" className="grid min-h-screen place-items-center bg-canvas p-5"><section className="card max-w-md p-7 text-center"><h1 className="display text-2xl font-bold">Finishing sign-in…</h1>{displayedError ? <><p className="mt-3 text-danger">{displayedError}</p><Link className="btn btn-primary mt-5" href="/login">Back to login</Link></> : <p className="mt-3 text-muted">Connecting your secure session.</p>}</section></main>;
}
