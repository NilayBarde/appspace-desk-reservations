import { loadPrefs, savePrefs, saveLastBookedDate } from "./preferences.js";
import { getTargetDates, bookAllDays, parseExistingBookings } from "./booking-engine.js";
import { HOLIDAYS, HOLIDAY_YEAR } from "./holidays.js";
import { searchDesks, parseAvailability } from "./desk-search.js";
import { formatUtcToEt, DOW_NAMES } from "./time.js";

export function createApp({ api, user, deskLookup, storage }) {
  const old = document.getElementById("desk-res-app");
  if (old) { old.remove(); return; }

  const overlay = document.createElement("div");
  overlay.id = "desk-res-app";
  overlay.className = "dra-overlay";

  const panel = document.createElement("div");
  panel.className = "dra-panel";
  overlay.appendChild(panel);

  let activeAbort = null;

  function dismiss() {
    if (activeAbort) activeAbort.abort();
    overlay.remove();
  }

  const closeX = document.createElement("button");
  closeX.className = "dra-btn-x";
  closeX.textContent = "×";
  closeX.addEventListener("click", dismiss);
  panel.appendChild(closeX);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismiss();
  });

  document.body.appendChild(overlay);

  const availCache = new Map();
  let searchTimeout = null;
  let snoozed = false;

  function clear() {
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    panel.appendChild(closeX);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }


  // ---- SETUP VIEW ----
  function renderSetup(existingPrefs) {
    clear();
    const prefs = existingPrefs || loadPrefs(storage);
    let selectedDesk = prefs.desk ? { name: prefs.desk, resourceId: deskLookup[prefs.desk] } : null;
    const selectedDays = new Set(prefs.days);
    let horizon = Math.min(prefs.horizon || 90, 90);

    panel.appendChild(el("h2", "dra-title", selectedDesk ? "Settings" : "Set Up Desk Booking"));

    // Desk search
    panel.appendChild(el("p", "dra-section-label", "Your desk"));
    const searchWrap = el("div", "dra-search-wrap");
    const searchInput = el("input", "dra-search");
    searchInput.type = "text";
    searchInput.placeholder = "Type desk name (e.g. 08W-147)...";
    if (selectedDesk) searchInput.value = selectedDesk.name;
    searchWrap.appendChild(searchInput);
    panel.appendChild(searchWrap);

    const resultsList = el("ul", "dra-results");
    resultsList.style.display = "none";
    panel.appendChild(resultsList);

    const selectedLabel = el("p", "dra-subtitle");
    if (selectedDesk) selectedLabel.textContent = "Selected: " + selectedDesk.name;
    panel.appendChild(selectedLabel);

    function renderResults(results) {
      while (resultsList.firstChild) resultsList.removeChild(resultsList.firstChild);
      if (results.length === 0) {
        resultsList.style.display = "none";
        return;
      }
      resultsList.style.display = "";
      for (const r of results) {
        const li = el("li", null, r.name);
        if (r.availability) {
          const span = el("span", "dra-results-status");
          const entries = [...r.availability.entries()];
          if (entries.length === 0) {
            span.textContent = " — available";
          } else {
            span.textContent = " — " + entries.map(([name, count]) => name + " (" + count + " days)").join(", ");
          }
          li.appendChild(span);
        }
        li.addEventListener("click", () => {
          selectedDesk = { name: r.name, resourceId: r.resourceId };
          searchInput.value = r.name;
          selectedLabel.textContent = "Selected: " + r.name;
          resultsList.style.display = "none";
        });
        resultsList.appendChild(li);
      }
    }

    async function fetchAvailability(results) {
      const today = new Date().toISOString().slice(0, 10);
      const endDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
      return Promise.all(results.map(async (r) => {
        if (availCache.has(r.resourceId)) {
          return { ...r, availability: availCache.get(r.resourceId) };
        }
        try {
          const events = await api.getResourceEvents(r.resourceId, today, endDate);
          const avail = parseAvailability(events);
          availCache.set(r.resourceId, avail);
          return { ...r, availability: avail };
        } catch {
          return r;
        }
      }));
    }

    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimeout);
      const q = searchInput.value.trim();
      if (q.length < 2) {
        resultsList.style.display = "none";
        return;
      }
      searchTimeout = setTimeout(async () => {
        const results = searchDesks(deskLookup, q, 10);
        const enriched = await fetchAvailability(results);
        renderResults(enriched);
      }, 300);
    });

    // Day selection
    panel.appendChild(el("hr", "dra-divider"));
    panel.appendChild(el("p", "dra-section-label", "Days in office"));
    const daysRow = el("div", "dra-days");
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    for (const d of dayNames) {
      const btn = el("button", "dra-day-btn" + (selectedDays.has(d) ? " dra-selected" : ""), d);
      btn.addEventListener("click", () => {
        if (selectedDays.has(d)) {
          selectedDays.delete(d);
          btn.className = "dra-day-btn";
        } else {
          selectedDays.add(d);
          btn.className = "dra-day-btn dra-selected";
        }
      });
      daysRow.appendChild(btn);
    }
    panel.appendChild(daysRow);

    // No-show warning
    const warn = el("div", "dra-warning", "Only select days you'll actually be in. Appspace tracks no-shows.");
    panel.appendChild(warn);

    // Horizon picker
    panel.appendChild(el("p", "dra-section-label", "Booking horizon"));
    const horizonRow = el("div", "dra-horizon");
    const presets = [{ label: "1 month", val: 30 }, { label: "2 months", val: 60 }, { label: "3 months", val: 90 }];
    const customInput = el("input", "dra-horizon-custom");
    customInput.type = "number";
    customInput.min = "1";
    customInput.max = "90";
    customInput.placeholder = "days";

    for (const p of presets) {
      const btn = el("button", "dra-horizon-btn" + (horizon === p.val ? " dra-selected" : ""), p.label);
      btn.addEventListener("click", () => {
        horizon = p.val;
        customInput.value = "";
        horizonRow.querySelectorAll(".dra-horizon-btn").forEach((b) => b.classList.remove("dra-selected"));
        btn.classList.add("dra-selected");
      });
      horizonRow.appendChild(btn);
    }

    customInput.addEventListener("input", () => {
      const v = parseInt(customInput.value, 10);
      if (v > 0 && v <= 90) {
        horizon = v;
        horizonRow.querySelectorAll(".dra-horizon-btn").forEach((b) => b.classList.remove("dra-selected"));
      }
    });
    horizonRow.appendChild(customInput);
    const horizonHint = el("p", "dra-hint", "Max 90 days (3 months)");
    horizonRow.appendChild(horizonHint);
    panel.appendChild(horizonRow);

    // Save button
    const saveBtn = el("button", "dra-btn dra-btn-primary", "Save & Continue");
    saveBtn.style.marginTop = "1rem";
    saveBtn.addEventListener("click", () => {
      if (!selectedDesk) { window.alert("Please select a desk."); return; }
      if (selectedDays.size === 0) { window.alert("Please select at least one day."); return; }
      savePrefs(storage, { desk: selectedDesk.name, days: [...selectedDays], horizon: Math.min(horizon, 90) });
      renderDashboard();
    });
    panel.appendChild(saveBtn);
  }

  // ---- DASHBOARD VIEW ----
  async function renderDashboard() {
    clear();
    const prefs = loadPrefs(storage);
    const resourceId = deskLookup[prefs.desk];

    if (!resourceId) {
      panel.appendChild(el("div", "dra-error", "Desk '" + prefs.desk + "' wasn't found. Check your desk name in Settings."));
      const fixBtn = el("button", "dra-btn dra-btn-primary", "Open Settings");
      fixBtn.addEventListener("click", () => renderSetup());
      panel.appendChild(fixBtn);
        return;
    }

    panel.appendChild(el("p", "dra-subtitle", "Loading your bookings..."));

    const today = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + prefs.horizon * 86400000).toISOString().slice(0, 10);

    let events;
    try {
      events = await api.getResourceEvents(resourceId, today, endDate);
    } catch {
      clear();
      panel.appendChild(el("div", "dra-error", "Failed to load bookings. Your session may have expired."));
        return;
    }

    const { own, others } = parseExistingBookings(events, user.id);
    clear();

    // Header
    const header = el("div", "dra-header");
    const headerInfo = el("div");
    headerInfo.appendChild(el("h2", "dra-title", "Desk Booking"));
    headerInfo.appendChild(el("p", "dra-subtitle", user.name + " · " + prefs.desk + " · " + prefs.days.join(", ")));
    header.appendChild(headerInfo);
    const gear = el("button", "dra-gear", "⚙");
    gear.title = "Settings";
    gear.addEventListener("click", () => renderSetup());
    header.appendChild(gear);
    panel.appendChild(header);

    // Conflict warning
    if (others.size > 0) {
      const names = [...others.entries()].map(([n, c]) => n + " (" + c + " days)").join(", ");
      const conflictWarn = el("div", "dra-warning", "This desk also has reservations from: " + names + ". Consider picking a different desk.");
      panel.appendChild(conflictWarn);
    }

    // Compute target dates
    const selectedDays = new Set(prefs.days);
    const existingDates = new Set(own.keys());
    const targetDates = getTargetDates({
      startDate: today,
      endDate,
      selectedDays,
      existingDates,
      holidays: HOLIDAYS,
    });

    // Status banner
    const sorted = [...own.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (sorted.length > 0) {
      const lastDate = sorted[sorted.length - 1][0];
      if (targetDates.length === 0 || snoozed) {
        panel.appendChild(el("div", "dra-status-ok", "You're all set through " + lastDate + "."));
      } else {
        panel.appendChild(el("div", "dra-status-info", "Booked through " + lastDate + ". " + targetDates.length + " new days available to book."));
      }
    } else if (targetDates.length > 0 && !snoozed) {
      panel.appendChild(el("div", "dra-status-info", targetDates.length + " days available to book."));
    }

    if (new Date(endDate + "T00:00:00Z").getUTCFullYear() > HOLIDAY_YEAR) {
      panel.appendChild(el("div", "dra-warning", "Holidays are only loaded through " + HOLIDAY_YEAR + ". Ask the repo admin to update holidays.js for " + (HOLIDAY_YEAR + 1) + "."));
    }

    // Actions
    const actions = el("div", "dra-actions");
    if (targetDates.length > 0 && !snoozed) {
      const bookBtn = el("button", "dra-btn dra-btn-primary", "Book New Days (" + targetDates.length + ")");
      bookBtn.addEventListener("click", () => renderProgress(resourceId, targetDates, own));
      actions.appendChild(bookBtn);
      const skipBtn = el("button", "dra-btn dra-btn-secondary", "Not now");
      skipBtn.addEventListener("click", () => {
        snoozed = true;
        renderDashboard();
      });
      actions.appendChild(skipBtn);
    } else {
      const bookBtn = el("button", "dra-btn dra-btn-primary", "Book New Days");
      bookBtn.addEventListener("click", () => {
        snoozed = false;
        if (targetDates.length > 0) {
          renderProgress(resourceId, targetDates, own);
        } else {
          renderSetup();
        }
      });
      actions.appendChild(bookBtn);
    }
    if (sorted.length > 0) {
      const cancelBtn = el("button", "dra-btn dra-btn-secondary", "Select days to cancel");
      cancelBtn.addEventListener("click", () => renderCancel(sorted, resourceId));
      actions.appendChild(cancelBtn);
    }
    panel.appendChild(actions);

    // Reservation list
    if (sorted.length > 0) {
      panel.appendChild(el("hr", "dra-divider"));
      panel.appendChild(el("p", "dra-section-label", "Your reservations"));
      let currentMonth = "";
      for (const [day, info] of sorted) {
        const month = day.slice(0, 7);
        if (month !== currentMonth) {
          currentMonth = month;
          const monthDate = new Date(day + "T12:00:00Z");
          const monthName = monthDate.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
          panel.appendChild(el("p", "dra-month-label", monthName));
        }
        const item = el("div", "dra-res-item");
        const d = new Date(day + "T12:00:00Z");
        item.appendChild(el("span", "dra-res-date", day));
        item.appendChild(el("span", "dra-res-day", DOW_NAMES[d.getUTCDay()]));
        const startEt = formatUtcToEt(info.startAt);
        const endEt = formatUtcToEt(info.endAt);
        if (startEt && endEt) {
          item.appendChild(el("span", "dra-res-status", startEt + " – " + endEt));
        }
        item.appendChild(el("span", "dra-res-status", info.status || ""));
        panel.appendChild(item);
      }
    }

  }

  // ---- CANCEL VIEW ----
  function renderCancel(sorted, resourceId) {
    clear();
    panel.appendChild(el("h2", "dra-title", "Cancel Reservations"));

    const checked = new Set();

    // Range picker
    panel.appendChild(el("p", "dra-section-label", "Select date range"));
    const rangePicker = el("div", "dra-range-picker");
    const fromSelect = document.createElement("select");
    const toSelect = document.createElement("select");
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "From...";
    fromSelect.appendChild(emptyOpt);
    const emptyOpt2 = document.createElement("option");
    emptyOpt2.value = "";
    emptyOpt2.textContent = "To...";
    toSelect.appendChild(emptyOpt2);
    for (const [day] of sorted) {
      const o1 = document.createElement("option");
      o1.value = day;
      o1.textContent = day;
      fromSelect.appendChild(o1);
      const o2 = document.createElement("option");
      o2.value = day;
      o2.textContent = day;
      toSelect.appendChild(o2);
    }
    rangePicker.appendChild(fromSelect);
    rangePicker.appendChild(el("span", null, "to"));
    rangePicker.appendChild(toSelect);

    const rangeBtn = el("button", "dra-btn dra-btn-secondary", "Select Range");
    rangePicker.appendChild(rangeBtn);
    panel.appendChild(rangePicker);

    // Count
    const countEl = el("p", "dra-cancel-count", "Cancelling 0 days.");
    panel.appendChild(countEl);

    function updateCount() {
      countEl.textContent = "Cancelling " + checked.size + " day" + (checked.size !== 1 ? "s" : "") + ".";
    }

    // Individual checkboxes
    panel.appendChild(el("p", "dra-section-label", "Or select individual days"));
    const checkList = el("div");
    const checkboxes = [];
    for (const [day, info] of sorted) {
      const item = el("div", "dra-res-item");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "dra-cancel-check";
      cb.addEventListener("change", () => {
        if (cb.checked) checked.add(day);
        else checked.delete(day);
        updateCount();
      });
      checkboxes.push({ day, cb });
      item.appendChild(cb);
      item.appendChild(el("span", "dra-res-date", day));
      const d = new Date(day + "T12:00:00Z");
      item.appendChild(el("span", "dra-res-day", DOW_NAMES[d.getUTCDay()]));
      checkList.appendChild(item);
    }
    panel.appendChild(checkList);

    rangeBtn.addEventListener("click", () => {
      const from = fromSelect.value;
      const to = toSelect.value;
      if (!from || !to) return;
      for (const { day, cb } of checkboxes) {
        if (day >= from && day <= to) {
          cb.checked = true;
          checked.add(day);
        }
      }
      updateCount();
    });

    // Actions
    const actions = el("div", "dra-actions");
    actions.style.marginTop = "1rem";
    const confirmBtn = el("button", "dra-btn dra-btn-danger", "Confirm Cancellation");
    confirmBtn.addEventListener("click", async () => {
      if (checked.size === 0) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Cancelling...";
      for (const day of checked) {
        const info = sorted.find(([d]) => d === day);
        if (info && info[1].reservationId) {
          await api.deleteReservation(info[1].reservationId);
        }
      }
      renderDashboard();
    });
    actions.appendChild(confirmBtn);

    const backBtn = el("button", "dra-btn dra-btn-secondary", "Back");
    backBtn.addEventListener("click", () => renderDashboard());
    actions.appendChild(backBtn);
    panel.appendChild(actions);

  }

  // ---- PROGRESS VIEW ----
  async function renderProgress(resourceId, targetDates, existingOwn) {
    clear();
    panel.appendChild(el("h2", "dra-title", "Booking in Progress"));
    panel.appendChild(el("p", "dra-subtitle", "(takes ~1-2 minutes)"));

    // Progress bar
    const progressWrap = el("div", "dra-progress-wrap");
    const bar = el("div", "dra-progress-bar");
    const fill = el("div", "dra-progress-fill");
    fill.style.width = "0%";
    bar.appendChild(fill);
    progressWrap.appendChild(bar);
    const progressText = el("p", "dra-progress-text", "0 / " + targetDates.length + " days");
    progressWrap.appendChild(progressText);
    panel.appendChild(progressWrap);

    // Stop button
    const abortCtrl = new AbortController();
    activeAbort = abortCtrl;
    const stopBtn = el("button", "dra-btn dra-btn-danger", "Stop");
    stopBtn.addEventListener("click", () => abortCtrl.abort());
    panel.appendChild(stopBtn);

    // Log
    const log = el("div", "dra-log");
    panel.appendChild(log);

    let completed = 0;
    let lastBooked = null;

    try {
      await bookAllDays({
        api,
        resourceId,
        user,
        targetDates,
        todayStr: new Date().toISOString().slice(0, 10),
        signal: abortCtrl.signal,
        onProgress: (result) => {
          completed++;
          const pct = Math.round((completed / targetDates.length) * 100);
          fill.style.width = pct + "%";
          progressText.textContent = completed + " / " + targetDates.length + " days";

          const entry = el("div", "dra-log-entry");
          if (result.ok) {
            entry.className = "dra-log-entry dra-log-ok";
            entry.textContent = result.date + (result.existing ? " (already booked)" : " booked");
            lastBooked = result.date;
          } else {
            entry.className = "dra-log-entry dra-log-fail";
            entry.textContent = result.date + " FAILED: " + (result.error || "unknown");
          }
          log.appendChild(entry);
          log.scrollTop = log.scrollHeight;
        },
      });
    } catch (err) {
      activeAbort = null;
      stopBtn.remove();
      if (err.message === "CANCELLED") {
        progressText.textContent = "Stopped. " + completed + " days processed.";
      } else if (err.message === "SESSION_EXPIRED") {
        panel.appendChild(el("div", "dra-error", "Your session expired. Refresh this page to re-login, then click 'Book My Desk' again — it will pick up where it left off."));
      } else {
        panel.appendChild(el("div", "dra-error", "Booking interrupted: " + err.message + ". Refresh the page and try again — progress is saved."));
      }
      if (lastBooked) saveLastBookedDate(storage, lastBooked);
      const backBtn = el("button", "dra-btn dra-btn-primary", "Back to Dashboard");
      backBtn.style.marginTop = "1rem";
      backBtn.addEventListener("click", () => renderDashboard());
      panel.appendChild(backBtn);
        return;
    }

    activeAbort = null;
    stopBtn.remove();

    if (lastBooked) {
      saveLastBookedDate(storage, lastBooked);
    }

    progressText.textContent = "Done! " + completed + " days processed.";

    const doneBtn = el("button", "dra-btn dra-btn-primary", "Back to Dashboard");
    doneBtn.style.marginTop = "1rem";
    doneBtn.addEventListener("click", () => renderDashboard());
    panel.appendChild(doneBtn);
  }

  // Start
  const prefs = loadPrefs(storage);
  if (prefs.desk && prefs.days.length > 0) {
    renderDashboard();
  } else {
    renderSetup();
  }
}
