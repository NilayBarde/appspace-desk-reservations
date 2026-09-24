import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { etToUtc, formatUtcToEt, todayEt, addDays } from "../../docs/app/time.js";

describe("etToUtc", () => {
  it("converts 9:00 AM ET to 13:00 UTC during EDT (summer)", () => {
    assert.equal(etToUtc("2026-06-15", 9, 0), "13:00:00.000Z");
  });

  it("converts 5:00 PM ET to 21:00 UTC during EDT (summer)", () => {
    assert.equal(etToUtc("2026-06-15", 17, 0), "21:00:00.000Z");
  });

  it("converts 9:00 AM ET to 14:00 UTC during EST (winter)", () => {
    assert.equal(etToUtc("2026-01-15", 9, 0), "14:00:00.000Z");
  });

  it("converts 5:00 PM ET to 22:00 UTC during EST (winter)", () => {
    assert.equal(etToUtc("2026-01-15", 17, 0), "22:00:00.000Z");
  });

  it("handles DST spring-forward transition date (Mar 8, 2026)", () => {
    assert.equal(etToUtc("2026-03-08", 9, 0), "13:00:00.000Z");
  });

  it("handles day before DST spring-forward (Mar 7, 2026 is EST)", () => {
    assert.equal(etToUtc("2026-03-07", 9, 0), "14:00:00.000Z");
  });

  it("handles DST fall-back transition date (Nov 1, 2026)", () => {
    assert.equal(etToUtc("2026-11-01", 9, 0), "14:00:00.000Z");
  });

  it("handles day after DST fall-back (Nov 2, 2026 is EST)", () => {
    assert.equal(etToUtc("2026-11-02", 9, 0), "14:00:00.000Z");
  });
});

describe("formatUtcToEt", () => {
  it("formats summer UTC to EDT 12-hour", () => {
    assert.equal(formatUtcToEt("2026-06-15T13:00:00.000Z"), "9:00 AM EDT");
  });

  it("formats winter UTC to EST 12-hour", () => {
    assert.equal(formatUtcToEt("2026-01-15T14:00:00.000Z"), "9:00 AM EST");
  });

  it("formats PM time correctly", () => {
    assert.equal(formatUtcToEt("2026-06-15T21:00:00.000Z"), "5:00 PM EDT");
  });

  it("returns empty string for empty input", () => {
    assert.equal(formatUtcToEt(""), "");
  });

  it("returns empty string for null input", () => {
    assert.equal(formatUtcToEt(null), "");
  });
});

describe("todayEt", () => {
  it("returns the ET date in the evening when UTC has rolled over (EDT)", () => {
    // 2026-09-24 9:30 PM EDT = 2026-09-25 01:30 UTC
    assert.equal(todayEt(new Date("2026-09-25T01:30:00Z")), "2026-09-24");
  });

  it("returns the ET date in the evening when UTC has rolled over (EST)", () => {
    // 2026-01-15 7:30 PM EST = 2026-01-16 00:30 UTC
    assert.equal(todayEt(new Date("2026-01-16T00:30:00Z")), "2026-01-15");
  });

  it("matches the UTC date during the ET daytime", () => {
    assert.equal(todayEt(new Date("2026-09-24T14:00:00Z")), "2026-09-24");
  });
});

describe("addDays", () => {
  it("adds days across a month boundary", () => {
    assert.equal(addDays("2026-09-28", 5), "2026-10-03");
  });

  it("adds days across the DST fall-back date", () => {
    assert.equal(addDays("2026-10-31", 2), "2026-11-02");
  });
});
