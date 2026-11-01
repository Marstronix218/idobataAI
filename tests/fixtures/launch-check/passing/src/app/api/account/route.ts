// Launch-check fixture: the account route's billing guard.
export function billingConfigured(env: Record<string, string | undefined>) {
  return Boolean((env.BILLING_PROVIDER && env.BILLING_PROVIDER !== "none") || env.STRIPE_SECRET_KEY || env.STRIPE_WEBHOOK_SECRET);
}
