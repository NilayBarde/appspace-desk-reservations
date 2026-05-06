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
