import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchDesks, parseAvailability } from "../../docs/app/desk-search.js";

const SAMPLE_LOOKUP = {
  "08W-125-A": "id-a",
  "08W-125-B": "id-b",
  "08W-125-C": "id-c",
  "08W-147-F": "id-f",
  "09E-200-A": "id-g",
};

describe("searchDesks", () => {
  it("returns matching desks by prefix", () => {
    const results = searchDesks(SAMPLE_LOOKUP, "08W-125");
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.name.startsWith("08W-125")));
  });

  it("is case-insensitive", () => {
    const results = searchDesks(SAMPLE_LOOKUP, "08w-125");
    assert.equal(results.length, 3);
  });

  it("caps results at maxResults", () => {
    const results = searchDesks(SAMPLE_LOOKUP, "08W", 2);
    assert.equal(results.length, 2);
  });

  it("returns empty for no match", () => {
    const results = searchDesks(SAMPLE_LOOKUP, "ZZZZZ");
    assert.equal(results.length, 0);
  });

  it("returns name and resourceId", () => {
    const results = searchDesks(SAMPLE_LOOKUP, "08W-147");
    assert.equal(results[0].name, "08W-147-F");
    assert.equal(results[0].resourceId, "id-f");
  });
});

describe("parseAvailability", () => {
  it("returns organizer names and counts", () => {
    const events = [
      { startAt: "2026-06-15T13:00:00.000Z", status: "Pending", organizer: { id: "u1", name: "Jane" } },
      { startAt: "2026-06-16T13:00:00.000Z", status: "Pending", organizer: { id: "u1", name: "Jane" } },
      { startAt: "2026-06-17T13:00:00.000Z", status: "Active", organizer: { id: "u2", name: "Bob" } },
    ];
    const result = parseAvailability(events);
    assert.equal(result.get("Jane"), 2);
    assert.equal(result.get("Bob"), 1);
  });

  it("excludes cancelled events", () => {
    const events = [
      { startAt: "2026-06-15T13:00:00.000Z", status: "Cancelled", organizer: { id: "u1", name: "Jane" } },
    ];
    const result = parseAvailability(events);
    assert.equal(result.size, 0);
  });

  it("returns empty map for no events", () => {
    const result = parseAvailability([]);
    assert.equal(result.size, 0);
  });
});
