import { describe, expect, it } from "vitest";

import {
  isExistingAccountError,
  isExistingAccountSignUp,
} from "../../apps/mobile/src/lib/auth/errors";

describe("detecting a signup for an address that already has an account", () => {
  it("reads the obfuscated response Supabase returns with enumeration protection on", () => {
    expect(isExistingAccountSignUp({ user: { identities: [] }, session: null })).toBe(true);
  });

  it("leaves a genuinely new, unconfirmed signup alone", () => {
    expect(isExistingAccountSignUp({ user: { identities: [{ id: "identity" }] }, session: null })).toBe(false);
  });

  it("leaves a signup that returned a session alone", () => {
    expect(isExistingAccountSignUp({ user: { identities: [] }, session: { access_token: "token" } })).toBe(false);
  });

  it.each([
    { code: "user_already_exists", message: "User already registered" },
    { message: "User already registered" },
    { message: "A user with this email address has already been registered" },
  ])("recognises the plain duplicate error: %o", (error) => {
    expect(isExistingAccountError(error)).toBe(true);
  });

  it.each([
    null,
    { message: "Invalid login credentials" },
    { message: "Password should be at least 8 characters" },
  ])("does not mistake an unrelated failure for a duplicate: %o", (error) => {
    expect(isExistingAccountError(error)).toBe(false);
  });
});
