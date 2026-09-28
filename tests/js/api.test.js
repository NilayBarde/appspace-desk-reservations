import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../../docs/app/api.js";

function recordingFetch() {
  const tokens = [];
  const fetchFn = async (url, options) => {
    tokens.push(options.headers.token);
    return { status: 200, json: async () => ({ items: [] }) };
  };
  return { fetchFn, tokens };
}

describe("createApi token", () => {
  it("sends a fixed token", async () => {
    const { fetchFn, tokens } = recordingFetch();
    const api = createApi(fetchFn, "abc");
    await api.getResourceEvents("r1", "2026-10-01", "2026-10-02");
    assert.deepEqual(tokens, ["abc"]);
  });

  it("reads a token getter on every request", async () => {
    const { fetchFn, tokens } = recordingFetch();
    let current = "first";
    const api = createApi(fetchFn, () => current);
    await api.getResourceEvents("r1", "2026-10-01", "2026-10-02");
    current = "refreshed";
    await api.deleteReservation("res1");
    assert.deepEqual(tokens, ["first", "refreshed"]);
  });
});
