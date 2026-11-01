import { describe, expect, it } from "vitest";
import {
  NON_PRODUCTION_APP_ENVS,
  VERCEL_PRODUCTION_NON_PRODUCTION_APP_ENVS,
  isProductionEnvironment,
  isSelfAttestedAgeAllowed,
} from "@/lib/age/environment";
import {
  NON_PRODUCTION_APP_ENVS as SCRIPT_NON_PRODUCTION_APP_ENVS,
  VERCEL_PRODUCTION_NON_PRODUCTION_APP_ENVS as SCRIPT_VERCEL_PRODUCTION_NON_PRODUCTION_APP_ENVS,
  isProductionEnvironment as scriptIsProductionEnvironment,
  isSelfAttestedAgeAllowed as scriptIsSelfAttestedAgeAllowed,
} from "../../scripts/lib/age-environment.mjs";

// `npm run launch-check` keeps its own copy of the production rule so it runs
// on plain Node. Every combination below must agree with the app's.
const APP_ENVS = [undefined, "", "  ", "production", "Production", "prod", "live", "typo", "local", " LOCAL ", "test", "dev", "development", "staging", " Staging ", "preview"];
const VERCEL_ENVS = [undefined, "", "production", " Production ", "preview", "development"];
const NODE_ENVS = [undefined, "production", " PRODUCTION ", "development", "test"];
const OPT_INS = [undefined, "", "true", " true ", "TRUE", "false", "1"];

function* environments() {
  for (const APP_ENV of APP_ENVS) {
    for (const VERCEL_ENV of VERCEL_ENVS) {
      for (const NODE_ENV of NODE_ENVS) {
        for (const ALLOW_SELF_ATTESTED_AGE of OPT_INS) yield { APP_ENV, VERCEL_ENV, NODE_ENV, ALLOW_SELF_ATTESTED_AGE };
      }
    }
  }
}

describe("scripts/lib/age-environment.mjs", () => {
  it("lists the same non-production APP_ENV values as the app", () => {
    expect(SCRIPT_NON_PRODUCTION_APP_ENVS).toEqual([...NON_PRODUCTION_APP_ENVS]);
    expect(SCRIPT_VERCEL_PRODUCTION_NON_PRODUCTION_APP_ENVS).toEqual([...VERCEL_PRODUCTION_NON_PRODUCTION_APP_ENVS]);
  });

  it("judges production and self-attestation exactly like src/lib/age/environment.ts", () => {
    let count = 0;
    for (const env of environments()) {
      count += 1;
      expect(scriptIsProductionEnvironment(env), JSON.stringify(env)).toBe(isProductionEnvironment(env));
      expect(scriptIsSelfAttestedAgeAllowed(env), JSON.stringify(env)).toBe(isSelfAttestedAgeAllowed(env));
    }
    expect(count).toBe(APP_ENVS.length * VERCEL_ENVS.length * NODE_ENVS.length * OPT_INS.length);
  });
});
