import { describe, expect, it } from "vitest";

import { assertDatabase } from "@/lib/server/http";

describe("assertDatabase raised-message mapping", () => {
  it("answers a database feature guard like a closed route gate", () => {
    expect(() => assertDatabase({ data: null, error: { message: "feature disabled", code: "P0001" } })).toThrow(
      expect.objectContaining({ status: 404, code: "not_found", message: "Resource not found." }),
    );
  });

  it("answers the database age guard with 403 age_requirement", () => {
    expect(() => assertDatabase({ data: null, error: { message: "age verification required", code: "P0001" } })).toThrow(
      expect.objectContaining({ status: 403, code: "age_requirement", message: "Confirm your age to continue." }),
    );
  });

  it("keeps mapping rate limits to 429", () => {
    expect(() => assertDatabase({ data: null, error: { message: "rate limit exceeded", code: "P0001" } })).toThrow(
      expect.objectContaining({ status: 429, code: "rate_limited" }),
    );
  });

  it("returns data when there is no error", () => {
    expect(assertDatabase({ data: { id: "task" }, error: null })).toEqual({ id: "task" });
  });
});
