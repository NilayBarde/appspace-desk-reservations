import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cancelReservations } from "../../docs/app/booking-engine.js";

function createMockApi(statusFor = () => 200) {
  const calls = [];
  return {
    calls,
    async deleteReservation(resId) {
      calls.push(resId);
      const status = statusFor(resId);
      if (status === "throw") throw new Error("network down");
      return { status, body: status >= 400 ? { message: "Not allowed" } : {} };
    },
  };
}

const bookings = new Map([
  ["2026-06-15", { reservationId: "r1" }],
  ["2026-06-16", { reservationId: "r2" }],
  ["2026-06-17", { reservationId: "r3" }],
]);

async function run(api, days, signal) {
  const results = [];
  await cancelReservations({ api, bookings, days, signal, onProgress: (r) => results.push(r) });
  return results;
}

describe("cancelReservations", () => {
  it("deletes each selected reservation", async () => {
    const api = createMockApi();
    const results = await run(api, ["2026-06-15", "2026-06-17"]);
    assert.deepEqual(api.calls, ["r1", "r3"]);
    assert.ok(results.every((r) => r.ok));
  });

  it("handles empty selection", async () => {
    const api = createMockApi();
    assert.deepEqual(await run(api, []), []);
    assert.equal(api.calls.length, 0);
  });

  it("reports a rejected or failed delete and keeps going", async () => {
    const api = createMockApi((id) => (id === "r1" ? 400 : id === "r2" ? "throw" : 200));
    const results = await run(api, ["2026-06-15", "2026-06-16", "2026-06-17"]);
    assert.deepEqual(results.map((r) => r.ok), [false, false, true]);
    assert.equal(results[0].error, "Not allowed");
    assert.equal(results[1].error, "network down");
  });

  it("reports a day with no reservation ID", async () => {
    const api = createMockApi();
    const results = await run(api, ["2026-07-01"]);
    assert.deepEqual(results, [{ ok: false, date: "2026-07-01", error: "no reservation ID" }]);
    assert.equal(api.calls.length, 0);
  });

  it("stops on an expired session", async () => {
    const api = createMockApi((id) => (id === "r2" ? 401 : 200));
    const results = [];
    await assert.rejects(
      cancelReservations({ api, bookings, days: ["2026-06-15", "2026-06-16", "2026-06-17"], onProgress: (r) => results.push(r) }),
      /SESSION_EXPIRED/
    );
    assert.deepEqual(api.calls, ["r1", "r2"]);
    assert.equal(results.length, 1);
  });

  it("stops when aborted", async () => {
    const api = createMockApi();
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(run(api, ["2026-06-15"], ctrl.signal), /CANCELLED/);
    assert.equal(api.calls.length, 0);
  });
});
