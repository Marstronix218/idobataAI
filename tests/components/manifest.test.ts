import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("web app manifest", () => {
  it("opens on /home but keeps the identity installs had while start_url was /feed", () => {
    const value = manifest();

    expect(value.start_url).toBe("/home");
    // Without an id, browsers derive it from start_url; moving start_url would
    // otherwise make existing installs a different app.
    expect(value.id).toBe("/feed");
  });
});
