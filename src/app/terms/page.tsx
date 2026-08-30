import Link from "next/link";

export default function TermsPage() {
  return <main id="main-content" className="app-theme paper-grid min-h-screen bg-canvas text-ink"><div className="app-page"><Link href="/sign-up" className="text-sm font-bold text-muted hover:text-ink">← Back to sign up</Link><h1 className="page-title mt-6">Terms of use</h1><div className="card mt-6 space-y-5 p-6 leading-7 text-muted"><p>This pre-deployment MVP is provided for evaluation. Use it lawfully, keep your account secure, and do not harass others, automate abuse, or attempt to bypass privacy controls.</p><p>You retain responsibility for the content you choose to publish. AI follower content is generated or selected by software and is visibly labeled; it is not professional advice.</p><p>Before a public launch, replace these starter terms with counsel-reviewed terms for your organization, jurisdiction, billing model, and moderation process.</p></div></div></main>;
}
