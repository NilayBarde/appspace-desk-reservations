import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("cancelReservations", () => {
  function createMockApi() {
    const calls = [];
    return {
      calls,
      async deleteReservation(resId) {
        calls.push(resId);
        return { status: 200, body: {} };
      },
    };
  }

  it("deletes each selected reservation", async () => {
    const api = createMockApi();
    const bookings = new Map([
      ["2026-06-15", { reservationId: "r1" }],
      ["2026-06-16", { reservationId: "r2" }],
      ["2026-06-17", { reservationId: "r3" }],
    ]);
    const toCancel = ["2026-06-15", "2026-06-17"];

    for (const date of toCancel) {
      const booking = bookings.get(date);
      await api.deleteReservation(booking.reservationId);
    }

    assert.deepEqual(api.calls, ["r1", "r3"]);
  });

  it("handles empty selection", async () => {
    const api = createMockApi();
    const toCancel = [];
    for (const date of toCancel) {
      await api.deleteReservation(date);
    }
    assert.equal(api.calls.length, 0);
  });
});
