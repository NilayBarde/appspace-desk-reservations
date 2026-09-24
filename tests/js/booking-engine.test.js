import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bookAllDays } from "../../docs/app/booking-engine.js";

function createMockApi({ existingEvents = [], createFn, patchOk = true } = {}) {
  const calls = [];
  return {
    calls,
    async getResourceEvents() { return existingEvents; },
    async createReservation(resourceId, dateStr) {
      calls.push({ action: "create", dateStr });
      if (createFn) return createFn(dateStr);
      return { status: 200, body: { id: "res-1", events: [{ id: "evt-1" }] } };
    },
    async patchEventDate(eventId, dateStr) {
      calls.push({ action: "patch", dateStr });
      if (!patchOk) return { status: 200, body: { startAt: "2026-06-17T13:00:00.000Z" } };
      return { status: 200, body: { startAt: `${dateStr}T13:00:00.000Z` } };
    },
    async deleteReservation(resId) {
      calls.push({ action: "delete", resId });
      return { status: 200, body: {} };
    },
  };
}

describe("bookAllDays", () => {
  it("books dates within 7 days via direct create", async () => {
    const api = createMockApi();
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const dow = new Date(tomorrow + "T12:00:00Z").getUTCDay();
    if (dow === 0 || dow === 6) return;

    const results = [];
    await bookAllDays({
      api,
      resourceId: "res-1",
      user: { id: "u1", name: "Test", email: "t@t.com" },
      targetDates: [tomorrow],
      todayStr: today,
      onProgress: (r) => results.push(r),
    });

    assert.ok(api.calls.some((c) => c.action === "create"));
    assert.equal(results.length, 1);
    assert.ok(results[0].ok);
  });

  it("uses park-and-patch for dates beyond 7 days when direct fails", async () => {
    const today = "2026-06-15";
    const farDate = "2026-08-03";
    // Park candidate: a weekday 2-7 days from today that is unoccupied
    const parkDate = "2026-06-17";

    const api = createMockApi({
      createFn: (dateStr) => {
        if (dateStr === farDate) {
          return { status: 400, body: { message: "too far out" } };
        }
        return { status: 200, body: { id: "res-1", events: [{ id: "evt-1" }] } };
      },
    });

    const results = [];
    await bookAllDays({
      api,
      resourceId: "res-1",
      user: { id: "u1", name: "Test", email: "t@t.com" },
      targetDates: [farDate],
      todayStr: today,
      onProgress: (r) => results.push(r),
    });

    assert.ok(api.calls.some((c) => c.action === "create" && c.dateStr === farDate));
    assert.ok(api.calls.some((c) => c.action === "patch" && c.dateStr === farDate));
    assert.ok(results[0].ok);
  });

  it("deletes park reservation on patch failure", async () => {
    const today = "2026-06-15";
    const farDate = "2026-08-03";

    const api = createMockApi({
      patchOk: false,
      createFn: (dateStr) => {
        if (dateStr === farDate) {
          return { status: 400, body: { message: "too far out" } };
        }
        return { status: 200, body: { id: "res-1", events: [{ id: "evt-1" }] } };
      },
    });

    const results = [];
    await bookAllDays({
      api,
      resourceId: "res-1",
      user: { id: "u1", name: "Test", email: "t@t.com" },
      targetDates: [farDate],
      todayStr: today,
      onProgress: (r) => results.push(r),
    });

    assert.ok(api.calls.some((c) => c.action === "delete"));
    assert.ok(!results[0].ok);
  });

  it("surfaces the server's rejection reason on patch failure", async () => {
    const today = "2026-06-15";
    const farDate = "2026-08-03";

    const api = {
      calls: [],
      async getResourceEvents() { return []; },
      async createReservation(resourceId, dateStr) {
        if (dateStr === farDate) return { status: 400, body: { message: "too far out" } };
        return { status: 200, body: { id: "res-1", events: [{ id: "evt-1" }] } };
      },
      async patchEventDate() {
        return { status: 400, body: { type: "MaxAdvanceBooking", description: "Max reservation date." } };
      },
      async deleteReservation() { return { status: 200, body: {} }; },
    };

    const results = [];
    await bookAllDays({
      api,
      resourceId: "res-1",
      user: { id: "u1", name: "Test", email: "t@t.com" },
      targetDates: [farDate],
      todayStr: today,
      onProgress: (r) => results.push(r),
    });

    assert.ok(!results[0].ok);
    assert.match(results[0].error, /HTTP 400/);
    assert.match(results[0].error, /MaxAdvanceBooking/);
    assert.match(results[0].error, /Max reservation date/);
  });

  it("never frees today's booking as a park date", async () => {
    // 2026-06-15 is a Monday. Every day this week and next Monday is booked by the user.
    const today = "2026-06-15";
    const farDate = "2026-08-03";
    const own = ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-22"];
    const existingEvents = own.map((day, i) => ({
      startAt: `${day}T13:00:00.000Z`,
      status: day === today ? "Active" : "Pending",
      organizer: { id: "u1", name: "Test" },
      reservationId: `own-${i}`,
    }));

    const api = createMockApi({
      existingEvents,
      createFn: (dateStr) => {
        if (dateStr === farDate) return { status: 400, body: { message: "too far out" } };
        return { status: 200, body: { id: "res-park", events: [{ id: "evt-park" }] } };
      },
    });

    await bookAllDays({
      api,
      resourceId: "res-1",
      user: { id: "u1", name: "Test", email: "t@t.com" },
      targetDates: [farDate],
      todayStr: today,
      onProgress: () => {},
    });

    const deletes = api.calls.filter((c) => c.action === "delete").map((c) => c.resId);
    assert.ok(!deletes.includes("own-0"), "today's booking must not be freed");
    assert.ok(!deletes.includes("own-1"), "tomorrow's booking must not be freed");
    assert.equal(deletes[0], "own-2", "earliest booking 2+ days out is freed");
    const parkCreate = api.calls.find((c) => c.action === "create" && c.dateStr !== farDate);
    assert.equal(parkCreate.dateStr, "2026-06-17");
  });

  it("throws instead of freeing today when no later own booking exists", async () => {
    const today = "2026-06-15";
    const farDate = "2026-08-03";
    const others = ["2026-06-17", "2026-06-18", "2026-06-19", "2026-06-22"];
    const existingEvents = [
      { startAt: `${today}T13:00:00.000Z`, status: "Active", organizer: { id: "u1" }, reservationId: "own-today" },
      ...others.map((day) => ({ startAt: `${day}T13:00:00.000Z`, status: "Pending", organizer: { id: "u2" }, reservationId: "x" })),
    ];
    const api = createMockApi({
      existingEvents,
      createFn: () => ({ status: 400, body: { message: "too far out" } }),
    });

    await assert.rejects(
      bookAllDays({
        api,
        resourceId: "res-1",
        user: { id: "u1", name: "Test", email: "t@t.com" },
        targetDates: [farDate],
        todayStr: today,
        onProgress: () => {},
      }),
      /No free park dates/
    );
    assert.ok(!api.calls.some((c) => c.action === "delete"));
  });

  it("calls onProgress for each date", async () => {
    const api = createMockApi();
    const today = "2026-06-15";
    const dates = ["2026-06-16", "2026-06-17", "2026-06-18"];

    const results = [];
    await bookAllDays({
      api,
      resourceId: "res-1",
      user: { id: "u1", name: "Test", email: "t@t.com" },
      targetDates: dates,
      todayStr: today,
      onProgress: (r) => results.push(r),
    });

    assert.equal(results.length, 3);
  });

  it("passes custom start/end hours to booking", async () => {
    const api = createMockApi();
    const today = "2026-06-15";
    const dates = ["2026-06-16"];

    const results = [];
    await bookAllDays({
      api,
      resourceId: "res-1",
      user: { id: "u1", name: "Test", email: "t@t.com" },
      targetDates: dates,
      todayStr: today,
      startHour: 8,
      startMin: 30,
      endHour: 16,
      endMin: 0,
      onProgress: (r) => results.push(r),
    });

    assert.equal(results.length, 1);
    assert.ok(results[0].ok);
  });
});
