import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadPrefs, savePrefs } from "../../docs/app/preferences.js";
import { createMockStorage } from "./helpers.js";

describe("loadPrefs", () => {
  it("returns defaults when storage is empty", () => {
    const storage = createMockStorage();
    const prefs = loadPrefs(storage);
    assert.equal(prefs.desk, null);
    assert.deepEqual(prefs.days, []);
    assert.equal(prefs.lastBookedDate, null);
    assert.equal(prefs.title, "");
  });

  it("reads saved values", () => {
    const storage = createMockStorage({
      deskRes_desk: "08W-147-F",
      deskRes_days: "Tue,Wed,Thu",
      deskRes_lastBookedDate: "2026-08-14",
      deskRes_title: "My Desk",
    });
    const prefs = loadPrefs(storage);
    assert.equal(prefs.desk, "08W-147-F");
    assert.deepEqual(prefs.days, ["Tue", "Wed", "Thu"]);
    assert.equal(prefs.lastBookedDate, "2026-08-14");
    assert.equal(prefs.title, "My Desk");
  });
});

describe("savePrefs", () => {
  it("writes values to storage", () => {
    const storage = createMockStorage();
    savePrefs(storage, { desk: "08W-1", days: ["Mon", "Fri"] });
    assert.equal(storage.getItem("deskRes_desk"), "08W-1");
    assert.equal(storage.getItem("deskRes_days"), "Mon,Fri");
  });
});
