import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VERSION } from "../../docs/app/version.js";

describe("VERSION", () => {
  it("is a semver string", () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  });
});

describe("cache-busted loading", () => {
  it("loads modules with a ?v= query, as the bookmarklet does", async () => {
    const { bookAllDays } = await import("../../docs/app/booking-engine.js?v=probe");
    const { createApi } = await import("../../docs/app/api.js?v=probe");
    assert.equal(typeof bookAllDays, "function");
    assert.equal(typeof createApi, "function");
  });
});
