import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOLIDAYS } from "../../docs/app/holidays.js";
import { getTargetDates } from "../../docs/app/booking-engine.js";

describe("HOLIDAYS", () => {
  it("contains known 2026 holidays", () => {
    assert.ok(HOLIDAYS.includes("2026-01-01"));
    assert.ok(HOLIDAYS.includes("2026-12-25"));
    assert.ok(HOLIDAYS.includes("2026-11-26"));
  });

  it("does not contain weekends", () => {
    for (const h of HOLIDAYS) {
      const d = new Date(h + "T12:00:00Z");
      const dow = d.getUTCDay();
      assert.ok(dow !== 0 && dow !== 6, `${h} is a weekend`);
    }
  });
});

describe("getTargetDates", () => {
  it("returns only weekdays", () => {
    const dates = getTargetDates({
      startDate: "2026-06-01",
      endDate: "2026-06-14",
      selectedDays: new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]),
      existingDates: new Set(),
      holidays: [],
    });
    for (const d of dates) {
      const dow = new Date(d + "T12:00:00Z").getUTCDay();
      assert.ok(dow >= 1 && dow <= 5, `${d} is not a weekday`);
    }
  });

  it("filters to only selected days", () => {
    const dates = getTargetDates({
      startDate: "2026-06-01",
      endDate: "2026-06-14",
      selectedDays: new Set(["Tue", "Thu"]),
      existingDates: new Set(),
      holidays: [],
    });
    const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const d of dates) {
      const name = DOW_NAMES[new Date(d + "T12:00:00Z").getUTCDay()];
      assert.ok(name === "Tue" || name === "Thu", `${d} (${name}) not in selected days`);
    }
  });

  it("excludes existing bookings", () => {
    const dates = getTargetDates({
      startDate: "2026-06-01",
      endDate: "2026-06-07",
      selectedDays: new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]),
      existingDates: new Set(["2026-06-02", "2026-06-04"]),
      holidays: [],
    });
    assert.ok(!dates.includes("2026-06-02"));
    assert.ok(!dates.includes("2026-06-04"));
  });

  it("excludes holidays", () => {
    const dates = getTargetDates({
      startDate: "2026-11-25",
      endDate: "2026-11-30",
      selectedDays: new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]),
      existingDates: new Set(),
      holidays: ["2026-11-26", "2026-11-27"],
    });
    assert.ok(!dates.includes("2026-11-26"));
    assert.ok(!dates.includes("2026-11-27"));
  });

  it("returns empty array when no days match", () => {
    const dates = getTargetDates({
      startDate: "2026-06-06",
      endDate: "2026-06-07",
      selectedDays: new Set(["Mon"]),
      existingDates: new Set(),
      holidays: [],
    });
    assert.equal(dates.length, 0);
  });
});
