import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadPrefs, savePrefs, clearResumeState, getResumeFrom } from "../../docs/app/preferences.js";
import { createMockStorage } from "./helpers.js";

describe("loadPrefs", () => {
  it("returns defaults when storage is empty", () => {
    const storage = createMockStorage();
    const prefs = loadPrefs(storage);
    assert.equal(prefs.desk, null);
    assert.deepEqual(prefs.days, []);
    assert.equal(prefs.horizon, 90);
    assert.equal(prefs.lastBookedDate, null);
  });

  it("reads saved values", () => {
    const storage = createMockStorage({
      deskRes_desk: "08W-147-F",
      deskRes_days: "Tue,Wed,Thu",
      deskRes_horizon: "180",
      deskRes_lastBookedDate: "2026-08-14",
    });
    const prefs = loadPrefs(storage);
    assert.equal(prefs.desk, "08W-147-F");
    assert.deepEqual(prefs.days, ["Tue", "Wed", "Thu"]);
    assert.equal(prefs.horizon, 180);
    assert.equal(prefs.lastBookedDate, "2026-08-14");
  });
});

describe("savePrefs", () => {
  it("writes values to storage", () => {
    const storage = createMockStorage();
    savePrefs(storage, { desk: "08W-1", days: ["Mon", "Fri"], horizon: 365 });
    assert.equal(storage.getItem("deskRes_desk"), "08W-1");
    assert.equal(storage.getItem("deskRes_days"), "Mon,Fri");
    assert.equal(storage.getItem("deskRes_horizon"), "365");
  });
});

describe("resume state", () => {
  it("getResumeFrom returns null when not set", () => {
    const storage = createMockStorage();
    assert.equal(getResumeFrom(storage), null);
  });

  it("clearResumeState removes the key", () => {
    const storage = createMockStorage({ deskRes_resumeFrom: "2026-06-10" });
    clearResumeState(storage);
    assert.equal(storage.getItem("deskRes_resumeFrom"), null);
  });
});

describe("horizon presets", () => {
  it("90 for 3 months", () => {
    const storage = createMockStorage({ deskRes_horizon: "90" });
    assert.equal(loadPrefs(storage).horizon, 90);
  });

  it("180 for 6 months", () => {
    const storage = createMockStorage({ deskRes_horizon: "180" });
    assert.equal(loadPrefs(storage).horizon, 180);
  });

  it("365 for 1 year", () => {
    const storage = createMockStorage({ deskRes_horizon: "365" });
    assert.equal(loadPrefs(storage).horizon, 365);
  });

  it("clamps invalid values to 90", () => {
    const storage = createMockStorage({ deskRes_horizon: "-5" });
    assert.equal(loadPrefs(storage).horizon, 90);
  });
});
