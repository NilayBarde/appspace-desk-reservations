import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findParkCandidates } from "../../docs/app/booking-engine.js";

describe("findParkCandidates", () => {
  it("returns weekdays 2-7 days out that are not occupied", () => {
    const today = "2026-06-15";
    const candidates = findParkCandidates(today, new Set());
    assert.ok(candidates.length > 0);
    for (const c of candidates) {
      const d = new Date(c + "T12:00:00Z");
      assert.ok(d.getUTCDay() >= 1 && d.getUTCDay() <= 5);
    }
  });

  it("excludes occupied dates", () => {
    const today = "2026-06-15";
    const occupied = new Set(["2026-06-17", "2026-06-18", "2026-06-19"]);
    const candidates = findParkCandidates(today, occupied);
    for (const c of candidates) {
      assert.ok(!occupied.has(c));
    }
  });

  it("returns empty when all park dates occupied", () => {
    const today = "2026-06-15";
    const all = new Set();
    for (let i = 2; i <= 7; i++) {
      const d = new Date("2026-06-15T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      all.add(d.toISOString().slice(0, 10));
    }
    const candidates = findParkCandidates(today, all);
    assert.equal(candidates.length, 0);
  });
});
