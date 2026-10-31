import { ageCheckInputSchema } from "@idobata/contracts";
import { requireAdult } from "@/lib/age/check";
import { createAgeToken } from "@/lib/age/tokens";
import { getFlags } from "@/lib/flags";
import { requireApiGate } from "@/lib/flags/route-gates";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientRateKey } from "@/lib/server/client-ip";
import { assertDatabase, ok, parseJson, withApi } from "@/lib/server/http";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { assertJsonContentType, assertNotCrossSite } from "@/lib/server/request-guards";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/**
 * Whether sign-up needs the age check: `{ required }` is true while Pivot A is
 * on. Public and always available, so clients can decide whether to ask for a
 * date of birth; the auth hook and the database still enforce the gate.
 */
export async function GET(request: Request) {
  return withApi(async () => {
    const key = clientRateKey(request);
    if (key) await enforceRateLimit(key, "auth:age-requirement", 60, 60);
    const flags = await getFlags();
    return ok({ required: flags.pivotA }, NO_STORE);
  });
}

/**
 * The age gate before sign-up (PLAN D5). Public: there is no account yet.
 * Runs the AgeVerifier on the date of birth, which is never stored or logged.
 * On a pass, stores only the sha256 of a random single-use token, valid for
 * 15 minutes, and returns the token for `signUp({ options: { data: {
 * age_token } } })`; the before_user_created hook consumes it. Under 18
 * answers 403 `age_requirement` and stores nothing. 404 while Pivot A is off.
 * JSON only (415 otherwise), never from another site (403), and limited per
 * client address, or by one coarse shared limit when the address is unknown.
 */
export async function POST(request: Request) {
  return withApi(async () => {
    await requireApiGate("pivot_a");
    assertNotCrossSite(request);
    assertJsonContentType(request);
    const key = clientRateKey(request);
    if (key) await enforceRateLimit(key, "auth:age-check", 10, 900);
    else await enforceRateLimit("unknown-client", "auth:age-check:unknown-client", 300, 900);
    const input = await parseJson(request, ageCheckInputSchema);
    const method = await requireAdult(input);

    const now = new Date();
    const { token, tokenHash, expiresAt } = createAgeToken(now);
    assertDatabase(await createAdminClient().from("age_verification_tokens").insert({
      token_hash: tokenHash,
      method,
      verified_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    }));
    return ok({ token, expiresAt: expiresAt.toISOString() }, NO_STORE);
  });
}
