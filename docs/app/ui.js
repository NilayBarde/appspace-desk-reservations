import { loadPrefs, savePrefs, saveLastBookedDate, parseTime } from "./preferences.js";
import { getTargetDates, bookAllDays, parseExistingBookings } from "./booking-engine.js";
import { HOLIDAYS, HOLIDAY_YEAR } from "./holidays.js";
import { searchDesks, parseAvailability } from "./desk-search.js";
import { etToUtc, DOW_NAMES } from "./time.js";

const MAX_BOOKING_DAYS = 90;

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
      const endDate = new Date(Date.now() + MAX_BOOKING_DAYS * 86400000).toISOString().slice(0, 10);
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

    // Reservation name
    panel.appendChild(el("hr", "dra-divider"));
    panel.appendChild(el("p", "dra-section-label", "Reservation name (optional)"));
    const titleInput = el("input", "dra-search");
    titleInput.type = "text";
    titleInput.placeholder = "Workspace Reservation";
    titleInput.value = prefs.title || "";
    panel.appendChild(titleInput);
    panel.appendChild(el("p", "dra-hint", "Shows in Appspace as reservation title. Leave blank for default."));

    // Booking hours
    panel.appendChild(el("hr", "dra-divider"));
    panel.appendChild(el("p", "dra-section-label", "Booking hours"));
    const timeRow = el("div", "dra-days");
    timeRow.style.alignItems = "center";
    timeRow.style.gap = "0.5rem";
    const startTimeInput = el("input", "dra-search");
    startTimeInput.type = "time";
    startTimeInput.value = prefs.startTime || "09:00";
    startTimeInput.style.width = "7rem";
    const toLabel = el("span", "dra-hint", "to");
    toLabel.style.margin = "0 0.25rem";
    const endTimeInput = el("input", "dra-search");
    endTimeInput.type = "time";
    endTimeInput.value = prefs.endTime || "17:00";
    endTimeInput.style.width = "7rem";
    timeRow.appendChild(startTimeInput);
    timeRow.appendChild(toLabel);
    timeRow.appendChild(endTimeInput);
    panel.appendChild(timeRow);
    panel.appendChild(el("p", "dra-hint", "Times are Eastern (ET) and adjust automatically for daylight saving."));

    // No-show warning
    const warn = el("div", "dra-warning", "Only select days you'll actually be in. Appspace tracks no-shows.");
    panel.appendChild(warn);

    // Save button
    const saveBtn = el("button", "dra-btn dra-btn-primary", "Save & Continue");
    saveBtn.style.marginTop = "1rem";
    saveBtn.addEventListener("click", () => {
      if (!selectedDesk) { window.alert("Please select a desk."); return; }
      if (selectedDays.size === 0) { window.alert("Please select at least one day."); return; }
      const startTime = startTimeInput.value || "09:00";
      const endTime = endTimeInput.value || "17:00";
      if (startTime >= endTime) { window.alert("Start time must be before end time."); return; }
      savePrefs(storage, { desk: selectedDesk.name, days: [...selectedDays], title: titleInput.value.trim(), startTime, endTime });
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
    const endDate = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

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

    const sorted = [...own.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    // Header
    const header = el("div", "dra-header");
    const headerInfo = el("div");
    headerInfo.appendChild(el("h2", "dra-title", prefs.desk));
    const todayDow = new Date(today + "T12:00:00Z").getUTCDay();
    const todayDayName = DOW_NAMES[todayDow] || "";
    headerInfo.appendChild(el("p", "dra-subtitle", todayDayName + " · " + user.name));
    header.appendChild(headerInfo);
    const gear = el("button", "dra-gear", "⚙");
    gear.title = "Settings";
    gear.addEventListener("click", () => renderSetup());
    header.appendChild(gear);
    panel.appendChild(header);

    // Today section
    const isWeekday = todayDow >= 1 && todayDow <= 5;
    if (own.has(today)) {
      const todayInfo = own.get(today);
      const todayStatus = (todayInfo.status || "").toLowerCase();
      const todayWrap = el("div", "dra-today");
      if (todayStatus === "active") {
        const checkinBtn = el("button", "dra-btn dra-btn-primary dra-btn-disabled", "Checked In");
        checkinBtn.disabled = true;
        todayWrap.appendChild(checkinBtn);
      } else {
        const canCheckin = todayStatus === "checkin";
        const checkinBtn = el("button", "dra-btn dra-btn-primary" + (canCheckin ? "" : " dra-btn-disabled"), "Check In");
        if (!canCheckin) checkinBtn.disabled = true;
        checkinBtn.addEventListener("click", async () => {
          if (!canCheckin) return;
          checkinBtn.disabled = true;
          checkinBtn.textContent = "Checking in...";
          try {
            const todayEvents = await api.getTodayEvents();
            const toCheckin = todayEvents.filter((e) => (e.status || "").toLowerCase() === "checkin");
            if (toCheckin.length === 0) {
              checkinBtn.textContent = "Already checked in";
              return;
            }
            for (const evt of toCheckin) {
              const rIds = evt.resourceIds && evt.resourceIds.length > 0 ? evt.resourceIds : [resourceId];
              const { status } = await api.checkinEvent(evt.id, rIds);
              if (status === 401 || status === 403) {
                checkinBtn.textContent = "Session expired";
                return;
              }
            }
            checkinBtn.textContent = "Checked in!";
            checkinBtn.className = "dra-btn dra-btn-primary dra-btn-disabled";
          } catch {
            checkinBtn.textContent = "Check-in failed";
            checkinBtn.disabled = false;
          }
        });
        todayWrap.appendChild(checkinBtn);
        if (!canCheckin) {
          todayWrap.appendChild(el("span", "dra-hint", " Window not open yet"));
        }
      }
      panel.appendChild(todayWrap);
    } else if (isWeekday) {
      const todayWrap = el("div", "dra-today");
      const rebookBtn = el("button", "dra-btn dra-btn-primary", "Rebook & Check In");
      rebookBtn.addEventListener("click", async () => {
        rebookBtn.disabled = true;
        rebookBtn.textContent = "Rebooking...";
        try {
          const rebookPrefs = loadPrefs(storage);
          const { hour: rSH, minute: rSM } = parseTime(rebookPrefs.startTime);
          const { hour: rEH, minute: rEM } = parseTime(rebookPrefs.endTime);
          const startTime = etToUtc(today, rSH, rSM);
          const endTime = etToUtc(today, rEH, rEM);
          const title = prefs.title || undefined;
          const { status, body } = await api.createReservation(resourceId, today, startTime, endTime, user, title);
          if (status === 401 || status === 403) {
            rebookBtn.textContent = "Session expired";
            return;
          }
          if (!body.events || !body.events[0]) {
            rebookBtn.textContent = body.message || "Rebook failed";
            rebookBtn.disabled = false;
            return;
          }
          rebookBtn.textContent = "Checking in...";
          const eventId = body.events[0].id;
          const { status: ciStatus } = await api.checkinEvent(eventId, [resourceId]);
          if (ciStatus === 401 || ciStatus === 403) {
            rebookBtn.textContent = "Rebooked (check-in failed)";
            return;
          }
          rebookBtn.textContent = "Rebooked & checked in!";
          rebookBtn.className = "dra-btn dra-btn-primary dra-btn-disabled";
        } catch {
          rebookBtn.textContent = "Rebook failed";
          rebookBtn.disabled = false;
        }
      });
      todayWrap.appendChild(rebookBtn);
      panel.appendChild(todayWrap);
    }

    // Quick stats
    if (sorted.length > 0) {
      const lastDate = sorted[sorted.length - 1][0];
      panel.appendChild(el("p", "dra-stats", sorted.length + " days booked through " + lastDate));
    }

    // Conflict warning
    if (others.size > 0) {
      const names = [...others.entries()].map(([n, c]) => n + " (" + c + " days)").join(", ");
      panel.appendChild(el("div", "dra-warning", "Desk shared with: " + names));
    }

    // Actions
    const actions = el("div", "dra-actions");
    const bookBtn = el("button", "dra-btn dra-btn-primary", "Book New Days");
    bookBtn.addEventListener("click", () => renderBookSetup(resourceId, own));
    actions.appendChild(bookBtn);
    if (sorted.length > 0) {
      const cancelBtn = el("button", "dra-btn dra-btn-secondary", "Cancel Days");
      cancelBtn.addEventListener("click", () => renderCancel(sorted, resourceId));
      actions.appendChild(cancelBtn);
      const viewBtn = el("button", "dra-btn dra-btn-secondary", "View All");
      viewBtn.addEventListener("click", () => renderReservationList(sorted));
      actions.appendChild(viewBtn);
    }
    panel.appendChild(actions);

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

  // ---- RESERVATION LIST VIEW ----
  function renderReservationList(sorted) {
    clear();
    panel.appendChild(el("h2", "dra-title", "All Reservations"));

    let currentMonth = "";
    for (const [day] of sorted) {
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
      panel.appendChild(item);
    }

    const actions = el("div", "dra-actions");
    actions.style.marginTop = "1rem";
    const backBtn = el("button", "dra-btn dra-btn-secondary", "Back");
    backBtn.addEventListener("click", () => renderDashboard());
    actions.appendChild(backBtn);
    panel.appendChild(actions);
  }

  // ---- BOOK SETUP VIEW ----
  function renderBookSetup(resourceId, existingOwn) {
    clear();
    const prefs = loadPrefs(storage);
    panel.appendChild(el("h2", "dra-title", "Book New Days"));

    const existingDates = new Set(existingOwn.keys());
    const existingCount = existingDates.size;
    const remaining = Math.max(0, MAX_BOOKING_DAYS - existingCount);

    if (remaining === 0) {
      panel.appendChild(el("div", "dra-warning", "You've reached the " + MAX_BOOKING_DAYS + "-day booking limit. Cancel some days first to book new ones."));
      const actions = el("div", "dra-actions");
      actions.style.marginTop = "1rem";
      const backBtn = el("button", "dra-btn dra-btn-secondary", "Back");
      backBtn.addEventListener("click", () => renderDashboard());
      actions.appendChild(backBtn);
      panel.appendChild(actions);
      return;
    }

    panel.appendChild(el("p", "dra-hint", existingCount + " days booked, " + remaining + " remaining."));

    panel.appendChild(el("p", "dra-section-label", "How many days out?"));
    const horizonRow = el("div", "dra-horizon");
    let horizon = 30;
    const presets = [{ label: "1 month", val: 30 }, { label: "2 months", val: 60 }, { label: "3 months", val: MAX_BOOKING_DAYS }];
    const customInput = el("input", "dra-horizon-custom");
    customInput.type = "number";
    customInput.min = "1";
    customInput.max = String(MAX_BOOKING_DAYS);
    customInput.placeholder = "days";

    for (const p of presets) {
      const btn = el("button", "dra-horizon-btn" + (horizon === p.val ? " dra-selected" : ""), p.label);
      btn.addEventListener("click", () => {
        horizon = p.val;
        customInput.value = "";
        horizonRow.querySelectorAll(".dra-horizon-btn").forEach((b) => b.classList.remove("dra-selected"));
        btn.classList.add("dra-selected");
        updatePreview();
      });
      horizonRow.appendChild(btn);
    }

    customInput.addEventListener("input", () => {
      const v = parseInt(customInput.value, 10);
      if (v > 0 && v <= MAX_BOOKING_DAYS) {
        horizon = v;
        horizonRow.querySelectorAll(".dra-horizon-btn").forEach((b) => b.classList.remove("dra-selected"));
        updatePreview();
      }
    });
    horizonRow.appendChild(customInput);
    const horizonHint = el("p", "dra-hint", "Max " + MAX_BOOKING_DAYS + " days");
    horizonRow.appendChild(horizonHint);
    panel.appendChild(horizonRow);

    const preview = el("p", "dra-subtitle");
    panel.appendChild(preview);

    const selectedDays = new Set(prefs.days);
    let targetDates = [];

    const holidayWarn = el("div", "dra-warning");
    holidayWarn.style.display = "none";
    panel.appendChild(holidayWarn);

    function updatePreview() {
      const today = new Date().toISOString().slice(0, 10);
      const endDate = new Date(Date.now() + horizon * 86400000).toISOString().slice(0, 10);
      const allTargets = getTargetDates({ startDate: today, endDate, selectedDays, existingDates, holidays: HOLIDAYS });
      targetDates = allTargets.slice(0, remaining);
      if (targetDates.length > 0) {
        preview.textContent = targetDates.length + " days to book (" + targetDates[0] + " to " + targetDates[targetDates.length - 1] + ")";
        if (allTargets.length > remaining) {
          preview.textContent += " — capped at " + MAX_BOOKING_DAYS + " total bookings";
        }
      } else {
        preview.textContent = "You're already booked for this period.";
      }
      if (new Date(endDate + "T00:00:00Z").getUTCFullYear() > HOLIDAY_YEAR) {
        holidayWarn.textContent = "Holidays are only loaded through " + HOLIDAY_YEAR + ". Ask the repo admin to update holidays.js for " + (HOLIDAY_YEAR + 1) + ".";
        holidayWarn.style.display = "";
      } else {
        holidayWarn.style.display = "none";
      }
    }
    updatePreview();

    const actions = el("div", "dra-actions");
    actions.style.marginTop = "1rem";
    const bookBtn = el("button", "dra-btn dra-btn-primary", "Book");
    bookBtn.addEventListener("click", () => {
      if (targetDates.length === 0) return;
      renderProgress(resourceId, targetDates, existingOwn);
    });
    actions.appendChild(bookBtn);

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
    stopBtn.style.marginBottom = "0.75rem";
    stopBtn.addEventListener("click", () => abortCtrl.abort());
    panel.appendChild(stopBtn);

    // Log
    const log = el("div", "dra-log");
    panel.appendChild(log);

    let completed = 0;
    let lastBooked = null;

    const prefs = loadPrefs(storage);
    const { hour: startHour, minute: startMin } = parseTime(prefs.startTime);
    const { hour: endHour, minute: endMin } = parseTime(prefs.endTime);
    try {
      await bookAllDays({
        api,
        resourceId,
        user,
        targetDates,
        todayStr: new Date().toISOString().slice(0, 10),
        signal: abortCtrl.signal,
        title: prefs.title || undefined,
        startHour,
        startMin,
        endHour,
        endMin,
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
