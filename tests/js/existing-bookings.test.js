import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExistingBookings } from "../../docs/app/booking-engine.js";

const ev = (organizer, day, extra = {}) => ({
  organizer,
  startAt: `${day}T13:00:00.000Z`,
  endAt: `${day}T21:00:00.000Z`,
  ...extra,
});

describe("parseExistingBookings", () => {
  it("separates own bookings from others", () => {
    const { own, others } = parseExistingBookings(
      [
        ev({ id: "me", name: "Me" }, "2026-07-01"),
        ev({ id: "other", name: "Jane" }, "2026-07-02"),
      ],
      "me"
    );
    assert.ok(own.has("2026-07-01"));
    assert.ok(!own.has("2026-07-02"));
    assert.equal(others.get("Jane"), 1);
  });

  it("returns the set of days occupied by other people", () => {
    const { othersDates } = parseExistingBookings(
      [
        ev({ id: "me", name: "Me" }, "2026-07-01"),
        ev({ id: "other", name: "Jane" }, "2026-07-02"),
        ev({ id: "other", name: "Jane" }, "2026-07-03"),
      ],
      "me"
    );
    assert.ok(othersDates.has("2026-07-02"));
    assert.ok(othersDates.has("2026-07-03"));
    assert.ok(!othersDates.has("2026-07-01"));
    assert.equal(othersDates.size, 2);
  });

  it("ignores cancelled/released bookings from others", () => {
    const { othersDates, others } = parseExistingBookings(
      [
        ev({ id: "other", name: "Jane" }, "2026-07-02", { status: "Cancelled" }),
        ev({ id: "other", name: "Jane" }, "2026-07-03", { status: "Released" }),
      ],
      "me"
    );
    assert.equal(othersDates.size, 0);
    assert.equal(others.size, 0);
  });
});
