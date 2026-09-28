// Carry the loader's ?v= cache-buster to every import so all modules come from the same release.
const q = new URL(import.meta.url).search;
const { loadPrefs, savePrefs, saveLastBookedDate, parseTime } = await import(`./preferences.js${q}`);
const { getTargetDates, bookAllDays, cancelReservations, parseExistingBookings } = await import(`./booking-engine.js${q}`);
const { HOLIDAYS, HOLIDAY_YEAR } = await import(`./holidays.js${q}`);
const { searchDesks, parseAvailability } = await import(`./desk-search.js${q}`);
const { etToUtc, formatUtcToEt, todayEt, addDays, formatDay, formatClock } = await import(`./time.js${q}`);
const { VERSION } = await import(`./version.js${q}`);

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

  // Set while a booking, cancellation or time edit is running, so closing the
  // panel mid-run asks first and then stops the run.
  let activeAbort = null;

  function dismiss() {
    if (activeAbort) {
      if (!window.confirm("Changes are still in progress. Stop and close?")) return;
      activeAbort.abort();
    }
    overlay.remove();
    document.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    // The bookmarklet can remove the overlay directly, bypassing dismiss().
    if (!overlay.isConnected) {
      document.removeEventListener("keydown", onKeydown);
      return;
    }
    if (e.key === "Escape") dismiss();
  }

  const topBar = document.createElement("div");
  topBar.className = "dra-topbar";
  const versionTag = document.createElement("span");
  versionTag.className = "dra-version";
  versionTag.textContent = "v" + VERSION;
  versionTag.title = "Book My Desk version";
  topBar.appendChild(versionTag);
  const closeX = document.createElement("button");
  closeX.className = "dra-btn-x";
  closeX.textContent = "×";
  closeX.addEventListener("click", dismiss);
  topBar.appendChild(closeX);
  panel.appendChild(topBar);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismiss();
  });

  document.addEventListener("keydown", onKeydown);

  document.body.appendChild(overlay);

  const availCache = new Map();
  let searchTimeout = null;

  function clear() {
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    panel.appendChild(topBar);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }


  // ---- MAIN VIEW (unified settings + status + actions) ----
  async function renderMain() {
    clear();
    const prefs = loadPrefs(storage);
    let selectedDesk = prefs.desk ? { name: prefs.desk, resourceId: deskLookup[prefs.desk] } : null;
    const selectedDays = new Set(prefs.days);
    // Replaced once bookings load; toggling a day refreshes the ready-to-book count.
    let updateReady = () => {};

    // == Section A: Settings ==
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
          resultsList.style.display = "none";
          savePrefs(storage, { desk: r.name });
          renderMain();
        });
        resultsList.appendChild(li);
      }
    }

    async function fetchAvailability(results) {
      const today = todayEt();
      const endDate = addDays(today, MAX_BOOKING_DAYS);
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

    // Days
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
        savePrefs(storage, { days: [...selectedDays] });
        updateReady();
      });
      daysRow.appendChild(btn);
    }
    panel.appendChild(daysRow);
    const noShowHint = el("p", "dra-hint", "Appspace tracks no-shows — only book days you'll be in.");
    noShowHint.style.fontSize = "0.72rem";
    noShowHint.style.marginBottom = "0";
    panel.appendChild(noShowHint);

    // Hours
    panel.appendChild(el("hr", "dra-divider"));
    panel.appendChild(el("p", "dra-section-label", "Booking hours"));
    const { row: timeRow, startInput: startTimeInput, endInput: endTimeInput } = buildTimeRow(prefs.startTime || "09:00", prefs.endTime || "17:00");
    panel.appendChild(timeRow);
    const timeError = el("p", "dra-field-error");
    timeError.style.display = "none";
    panel.appendChild(timeError);

    function saveTimesIfValid() {
      const s = startTimeInput.value || "09:00";
      const e = endTimeInput.value || "17:00";
      if (s < e) {
        savePrefs(storage, { startTime: s, endTime: e });
        timeError.style.display = "none";
        return;
      }
      const saved = loadPrefs(storage);
      timeError.textContent = "Start time must be before end time. New bookings keep using " +
        formatClock(saved.startTime) + " to " + formatClock(saved.endTime) + ".";
      timeError.style.display = "";
    }
    startTimeInput.addEventListener("change", saveTimesIfValid);
    endTimeInput.addEventListener("change", saveTimesIfValid);

    // Title (inline, compact)
    panel.appendChild(el("hr", "dra-divider"));
    const titleRow = el("div", "dra-days");
    titleRow.style.alignItems = "center";
    titleRow.style.gap = "0.5rem";
    const titleLabel = el("span", "dra-section-label", "Title");
    titleLabel.style.margin = "0";
    titleRow.appendChild(titleLabel);
    const titleInput = el("input", "dra-search");
    titleInput.type = "text";
    titleInput.placeholder = "Workspace Reservation";
    titleInput.value = prefs.title || "";
    titleInput.style.flex = "1";
    titleRow.appendChild(titleInput);
    panel.appendChild(titleRow);

    titleInput.addEventListener("blur", () => {
      savePrefs(storage, { title: titleInput.value.trim() });
    });

    // == Section B & C: Status + Actions (only if desk configured) ==
    const resourceId = selectedDesk ? deskLookup[selectedDesk.name] : null;
    if (!resourceId) {
      panel.appendChild(el("p", "dra-hint", "Select a desk to get started."));
      return;
    }

    panel.appendChild(el("hr", "dra-divider"));

    // Render buttons immediately (disabled), enable after data loads
    const statusEl = el("p", "dra-stats", "Loading bookings...");
    panel.appendChild(statusEl);
    const readyEl = el("p", "dra-ready");
    readyEl.style.display = "none";
    panel.appendChild(readyEl);

    const today = todayEt();
    const todayDow = new Date(today + "T12:00:00Z").getUTCDay();
    const isWeekday = todayDow >= 1 && todayDow <= 5;

    const checkinBtn = el("button", "dra-btn dra-btn-primary dra-btn-disabled", "Check In");
    checkinBtn.style.width = "100%";
    checkinBtn.disabled = true;

    const bookBtn = el("button", "dra-btn dra-btn-primary dra-btn-disabled", "Book New Days");
    bookBtn.style.width = "100%";
    bookBtn.disabled = true;

    const primaryRow = el("div", "dra-actions");
    primaryRow.style.display = "grid";
    primaryRow.style.gridTemplateColumns = isWeekday ? "1fr 1fr" : "1fr";
    if (isWeekday) primaryRow.appendChild(checkinBtn);
    primaryRow.appendChild(bookBtn);
    panel.appendChild(primaryRow);

    const secondaryRow = el("div", "dra-actions");
    secondaryRow.style.marginTop = "0.5rem";
    secondaryRow.style.display = "grid";
    secondaryRow.style.gridTemplateColumns = "1fr 1fr";
    const cancelBtn = el("button", "dra-btn dra-btn-secondary dra-btn-disabled", "Cancel Days");
    cancelBtn.disabled = true;
    secondaryRow.appendChild(cancelBtn);
    const editTimesBtn = el("button", "dra-btn dra-btn-secondary dra-btn-disabled", "Edit Times");
    editTimesBtn.disabled = true;
    secondaryRow.appendChild(editTimesBtn);
    panel.appendChild(secondaryRow);

    // Fetch data then enable
    const endDate = addDays(today, 365);
    let events;
    try {
      events = await api.getResourceEvents(resourceId, today, endDate);
    } catch {
      statusEl.className = "dra-error";
      statusEl.textContent = "Failed to load bookings. Your session may have expired.";
      return;
    }

    const { own, others, othersDates } = parseExistingBookings(events, user.id);
    const sorted = [...own.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    // Update status (expandable)
    if (sorted.length > 0) {
      const lastDate = sorted[sorted.length - 1][0];
      statusEl.textContent = sorted.length + " days booked through " + formatDay(lastDate, today);
    } else {
      statusEl.textContent = "No upcoming bookings.";
    }

    // Days that Book New Days would book at its longest horizon, so you can
    // tell from here whether there's anything new to book.
    const blockedDates = new Set([...own.keys(), ...othersDates]);
    const remaining = Math.max(0, MAX_BOOKING_DAYS - own.size);
    updateReady = () => {
      readyEl.style.display = "";
      readyEl.classList.remove("dra-ready-some");
      if (selectedDays.size === 0) {
        readyEl.textContent = "Pick your days in office to see what's open to book.";
        return;
      }
      if (remaining === 0) {
        readyEl.textContent = "You're at the " + MAX_BOOKING_DAYS + "-day booking limit.";
        return;
      }
      const open = getTargetDates({
        startDate: today,
        endDate: addDays(today, MAX_BOOKING_DAYS),
        selectedDays,
        existingDates: blockedDates,
        holidays: HOLIDAYS,
      }).length;
      const n = Math.min(open, remaining);
      if (n === 0) {
        readyEl.textContent = "Nothing new to book yet.";
        return;
      }
      readyEl.textContent = n + " new day" + (n !== 1 ? "s" : "") + " ready to book.";
      readyEl.classList.add("dra-ready-some");
    };
    updateReady();

    // Conflict warning
    if (others.size > 0) {
      const names = [...others.entries()].map(([n, c]) => n + " (" + c + " days)").join(", ");
      const warning = el("div", "dra-warning", "Desk shared with: " + names);
      panel.insertBefore(warning, primaryRow);
    }

    // Today's booking time
    if (own.has(today)) {
      const todayInfo = own.get(today);
      if (todayInfo.startAt && todayInfo.endAt) {
        const todayTime = el("p", "dra-hint", "Today: " + formatUtcToEt(todayInfo.startAt) + " – " + formatUtcToEt(todayInfo.endAt));
        todayTime.style.fontSize = "0.72rem";
        todayTime.style.margin = "0 0 0.5rem";
        panel.insertBefore(todayTime, primaryRow);
      }
    }

    // Enable Check In / Rebook button
    function markCheckedIn() {
      checkinBtn.textContent = "Checked in!";
      checkinBtn.className = "dra-btn dra-btn-primary dra-btn-disabled";
      checkinBtn.disabled = true;
    }

    async function doCheckin() {
      checkinBtn.disabled = true;
      checkinBtn.textContent = "Checking in...";
      try {
        const todayEvents = await api.getTodayEvents();
        const toCheckin = todayEvents.filter((e) => (e.status || "").toLowerCase() === "checkin");
        if (toCheckin.length === 0) { markCheckedIn(); return; }
        for (const evt of toCheckin) {
          const rIds = evt.resourceIds && evt.resourceIds.length > 0 ? evt.resourceIds : [resourceId];
          const { status } = await api.checkinEvent(evt.id, rIds);
          if (status === 401 || status === 403) {
            checkinBtn.textContent = "Session expired";
            return;
          }
        }
        markCheckedIn();
      } catch {
        checkinBtn.textContent = "Check-in failed";
        checkinBtn.disabled = false;
      }
    }

    if (isWeekday) {
      if (own.has(today)) {
        const todayInfo = own.get(today);
        const todayStatus = (todayInfo.status || "").toLowerCase();
        const canCheckin = todayStatus === "checkin";
        if (todayStatus === "active") {
          markCheckedIn();
        } else if (canCheckin) {
          checkinBtn.className = "dra-btn dra-btn-primary";
          checkinBtn.disabled = false;
          checkinBtn.addEventListener("click", doCheckin);
          doCheckin();
        }
      } else {
        checkinBtn.textContent = "Rebook & Check In";
        checkinBtn.className = "dra-btn dra-btn-primary";
        checkinBtn.disabled = false;
        checkinBtn.addEventListener("click", async () => {
          checkinBtn.disabled = true;
          checkinBtn.textContent = "Rebooking...";
          try {
            const rebookPrefs = loadPrefs(storage);
            const { hour: rSH, minute: rSM } = parseTime(rebookPrefs.startTime);
            const { hour: rEH, minute: rEM } = parseTime(rebookPrefs.endTime);
            const startTime = etToUtc(today, rSH, rSM);
            const endTime = etToUtc(today, rEH, rEM);
            const title = rebookPrefs.title || undefined;
            const { status, body } = await api.createReservation(resourceId, today, startTime, endTime, user, title);
            if (status === 401 || status === 403) {
              checkinBtn.textContent = "Session expired";
              return;
            }
            if (!body.events || !body.events[0]) {
              checkinBtn.textContent = body.message || "Rebook failed";
              checkinBtn.disabled = false;
              return;
            }
            checkinBtn.textContent = "Checking in...";
            const eventId = body.events[0].id;
            const { status: ciStatus } = await api.checkinEvent(eventId, [resourceId]);
            if (ciStatus === 401 || ciStatus === 403) {
              checkinBtn.textContent = "Rebooked (check-in failed)";
              return;
            }
            checkinBtn.textContent = "Rebooked & checked in!";
            checkinBtn.className = "dra-btn dra-btn-primary dra-btn-disabled";
          } catch {
            checkinBtn.textContent = "Rebook failed";
            checkinBtn.disabled = false;
          }
        });
      }
    }

    // Enable Book button
    bookBtn.className = "dra-btn dra-btn-primary";
    bookBtn.disabled = false;
    bookBtn.addEventListener("click", () => renderBookSetup(resourceId, own, othersDates));

    // Enable secondary buttons if there are bookings
    if (sorted.length > 0) {
      cancelBtn.className = "dra-btn dra-btn-secondary";
      cancelBtn.disabled = false;
      cancelBtn.addEventListener("click", () => renderCancel(sorted, resourceId));
      editTimesBtn.className = "dra-btn dra-btn-secondary";
      editTimesBtn.disabled = false;
      editTimesBtn.addEventListener("click", () => renderEditTimes(sorted, resourceId));
    }
  }

  // ---- HELPERS ----
  function buildTimeRow(startVal, endVal) {
    const row = el("div", "dra-days");
    row.style.alignItems = "center";
    row.style.gap = "0.5rem";
    const startInput = el("input", "dra-search");
    startInput.type = "time";
    startInput.value = startVal;
    startInput.style.width = "9rem";
    const toLabel = el("span", "dra-hint", "to");
    toLabel.style.margin = "0 0.25rem";
    const endInput = el("input", "dra-search");
    endInput.type = "time";
    endInput.value = endVal;
    endInput.style.width = "9rem";
    row.appendChild(startInput);
    row.appendChild(toLabel);
    row.appendChild(endInput);
    return { row, startInput, endInput };
  }

  // ---- PROGRESS HELPER ----
  function buildProgress(total, unit) {
    const progressWrap = el("div", "dra-progress-wrap");
    const bar = el("div", "dra-progress-bar");
    const fill = el("div", "dra-progress-fill");
    fill.style.width = "0%";
    bar.appendChild(fill);
    progressWrap.appendChild(bar);
    const progressText = el("p", "dra-progress-text", "0 / " + total + unit);
    progressWrap.appendChild(progressText);
    const log = el("div", "dra-log");

    let completed = 0;
    function record(ok, text) {
      completed++;
      fill.style.width = Math.round((completed / total) * 100) + "%";
      progressText.textContent = completed + " / " + total + unit;
      log.appendChild(el("div", "dra-log-entry " + (ok ? "dra-log-ok" : "dra-log-fail"), text));
      log.scrollTop = log.scrollHeight;
    }
    return { progressWrap, progressText, log, record };
  }

  // ---- DATE PICKER HELPER ----
  function buildDatePicker({ sorted, countLabel, renderRow }) {
    const checked = new Set();
    const frag = document.createDocumentFragment();

    frag.appendChild(el("p", "dra-section-label", "Select days"));
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
      o1.textContent = formatDay(day);
      fromSelect.appendChild(o1);
      const o2 = document.createElement("option");
      o2.value = day;
      o2.textContent = formatDay(day);
      toSelect.appendChild(o2);
    }
    rangePicker.appendChild(fromSelect);
    rangePicker.appendChild(el("span", null, "to"));
    rangePicker.appendChild(toSelect);
    const rangeBtn = el("button", "dra-btn dra-btn-secondary", "Select Range");
    rangePicker.appendChild(rangeBtn);
    const selectAllBtn = el("button", "dra-btn dra-btn-secondary", "Select All");
    rangePicker.appendChild(selectAllBtn);
    frag.appendChild(rangePicker);

    const countEl = el("p", "dra-cancel-count", countLabel + " 0 days.");
    frag.appendChild(countEl);
    function updateCount() {
      countEl.textContent = countLabel + " " + checked.size + " day" + (checked.size !== 1 ? "s" : "") + ".";
    }

    const checkList = el("div", "dra-scroll-list");
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
      item.appendChild(el("span", "dra-res-date", formatDay(day)));
      if (renderRow) renderRow(item, info);
      checkList.appendChild(item);
    }
    frag.appendChild(checkList);

    rangeBtn.addEventListener("click", () => {
      const from = fromSelect.value;
      const to = toSelect.value;
      if (!from || !to) return;
      for (const { day, cb } of checkboxes) {
        if (day >= from && day <= to) { cb.checked = true; checked.add(day); }
      }
      updateCount();
    });
    selectAllBtn.addEventListener("click", () => {
      for (const { day, cb } of checkboxes) { cb.checked = true; checked.add(day); }
      updateCount();
    });

    return { frag, checked };
  }

  // ---- CANCEL VIEW ----
  function renderCancel(sorted, resourceId) {
    clear();
    panel.appendChild(el("h2", "dra-title", "Cancel Days"));

    const { frag, checked } = buildDatePicker({ sorted, countLabel: "Cancelling" });
    panel.appendChild(frag);

    // Actions
    const actions = el("div", "dra-actions");
    actions.style.marginTop = "1rem";
    const confirmBtn = el("button", "dra-btn dra-btn-danger", "Confirm Cancellation");
    const backBtn = el("button", "dra-btn dra-btn-secondary", "Back");
    confirmBtn.addEventListener("click", async () => {
      if (checked.size === 0) return;
      if (!window.confirm("Cancel " + checked.size + " day" + (checked.size !== 1 ? "s" : "") + "? This cannot be undone.")) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Cancelling...";
      backBtn.disabled = true;

      const days = [...checked].sort();
      const { progressWrap, progressText, log, record } = buildProgress(days.length, " days");
      panel.appendChild(progressWrap);
      panel.appendChild(log);

      const abortCtrl = new AbortController();
      activeAbort = abortCtrl;
      let cancelled = 0;
      let failures = 0;
      try {
        await cancelReservations({
          api,
          bookings: new Map(sorted),
          days,
          signal: abortCtrl.signal,
          onProgress: (result) => {
            if (result.ok) cancelled++;
            else failures++;
            record(result.ok, formatDay(result.date) + (result.ok ? " cancelled" : " FAILED: " + result.error));
          },
        });
        progressText.textContent = "Done! " + cancelled + " cancelled" + (failures > 0 ? ", " + failures + " failed" : "") + ".";
      } catch (err) {
        if (err.message === "SESSION_EXPIRED") {
          panel.appendChild(el("div", "dra-error", "Your session expired after " + cancelled + " cancelled. Refresh the page, then open Book My Desk again to cancel the rest."));
        } else {
          progressText.textContent = "Stopped. " + cancelled + " cancelled.";
        }
      } finally {
        activeAbort = null;
      }
      confirmBtn.textContent = "Done";
      backBtn.disabled = false;
    });
    actions.appendChild(confirmBtn);

    backBtn.addEventListener("click", () => renderMain());
    actions.appendChild(backBtn);
    panel.appendChild(actions);

  }

  // ---- EDIT TIMES VIEW ----
  function renderEditTimes(sorted, resourceId) {
    clear();
    const prefs = loadPrefs(storage);

    panel.appendChild(el("h2", "dra-title", "Edit Times"));
    const { row: timeRow, startInput: startTimeInput, endInput: endTimeInput } = buildTimeRow(prefs.startTime || "09:00", prefs.endTime || "17:00");
    const etHint = el("span", "dra-hint", "ET");
    etHint.style.fontSize = "0.72rem";
    timeRow.appendChild(etHint);
    panel.appendChild(timeRow);
    panel.appendChild(el("hr", "dra-divider"));

    const { frag, checked } = buildDatePicker({
      sorted,
      countLabel: "Updating",
      renderRow: (item, info) => {
        const currentTimes = formatUtcToEt(info.startAt) + " – " + formatUtcToEt(info.endAt);
        item.appendChild(el("span", "dra-res-status", currentTimes));
      },
    });
    panel.appendChild(frag);

    // Actions
    const actions = el("div", "dra-actions");
    actions.style.marginTop = "1rem";
    const applyBtn = el("button", "dra-btn dra-btn-primary", "Apply Changes");
    const backBtn = el("button", "dra-btn dra-btn-secondary", "Back");
    applyBtn.addEventListener("click", async () => {
      if (checked.size === 0) return;
      const newStart = startTimeInput.value || "09:00";
      const newEnd = endTimeInput.value || "17:00";
      if (newStart >= newEnd) {
        window.alert("Start time must be before end time.");
        return;
      }

      const { hour: startHour, minute: startMin } = parseTime(newStart);
      const { hour: endHour, minute: endMin } = parseTime(newEnd);

      applyBtn.disabled = true;
      applyBtn.textContent = "Updating...";
      backBtn.disabled = true;

      const days = [...checked].sort();
      const { progressWrap, progressText, log, record } = buildProgress(days.length, "");
      panel.appendChild(progressWrap);
      panel.appendChild(log);

      const abortCtrl = new AbortController();
      activeAbort = abortCtrl;
      let updated = 0;
      let failures = 0;
      let stopped = false;

      try {
        for (const day of days) {
          if (abortCtrl.signal.aborted) { stopped = true; break; }
          const info = sorted.find(([d]) => d === day);
          if (!info || !info[1].eventId) {
            failures++;
            record(false, formatDay(day) + " SKIPPED: no event ID");
            continue;
          }

          const startTime = etToUtc(day, startHour, startMin);
          const endTime = etToUtc(day, endHour, endMin);

          try {
            const { status } = await api.patchEventDate(info[1].eventId, day, startTime, endTime);
            if (status === 401 || status === 403) {
              panel.appendChild(el("div", "dra-error", "Session expired after " + updated + " updated. Refresh the page and try again."));
              stopped = true;
              break;
            }
            if (status >= 200 && status < 300) {
              updated++;
              record(true, formatDay(day) + " updated");
            } else {
              failures++;
              record(false, formatDay(day) + " FAILED: HTTP " + status);
            }
          } catch (err) {
            failures++;
            record(false, formatDay(day) + " FAILED: " + (err.message || "network error"));
          }
        }
      } finally {
        activeAbort = null;
      }

      progressText.textContent = (stopped ? "Stopped. " : "Done! ") + updated + " updated" + (failures > 0 ? ", " + failures + " failed" : "") + ".";
      applyBtn.textContent = "Done";
      backBtn.disabled = false;
    });
    actions.appendChild(applyBtn);

    backBtn.addEventListener("click", () => renderMain());
    actions.appendChild(backBtn);
    panel.appendChild(actions);
  }


  // ---- BOOK SETUP VIEW ----
  function renderBookSetup(resourceId, existingOwn, othersDates = new Set()) {
    clear();
    const prefs = loadPrefs(storage);
    panel.appendChild(el("h2", "dra-title", "Book New Days"));

    const ownDates = new Set(existingOwn.keys());
    const existingCount = ownDates.size;
    const remaining = Math.max(0, MAX_BOOKING_DAYS - existingCount);
    // Exclude both the user's own bookings and days another person already holds
    // this desk — patching onto an occupied day is rejected by Appspace (HTTP 400).
    const existingDates = new Set([...ownDates, ...othersDates]);

    if (remaining === 0) {
      panel.appendChild(el("div", "dra-warning", "You've reached the " + MAX_BOOKING_DAYS + "-day booking limit. Cancel some days first to book new ones."));
      const actions = el("div", "dra-actions");
      actions.style.marginTop = "1rem";
      const backBtn = el("button", "dra-btn dra-btn-secondary", "Back");
      backBtn.addEventListener("click", () => renderMain());
      actions.appendChild(backBtn);
      panel.appendChild(actions);
      return;
    }


    panel.appendChild(el("p", "dra-section-label", "How many days out?"));
    const horizonRow = el("div", "dra-horizon");
    let horizon = Math.min(Math.max(prefs.horizon, 1), MAX_BOOKING_DAYS);
    const presets = [{ label: "1 month", val: 30 }, { label: "2 months", val: 60 }, { label: "3 months", val: MAX_BOOKING_DAYS }];
    const customInput = el("input", "dra-horizon-custom");
    customInput.type = "number";
    customInput.min = "1";
    customInput.max = String(MAX_BOOKING_DAYS);
    customInput.placeholder = "days";
    if (!presets.some((p) => p.val === horizon)) customInput.value = String(horizon);

    for (const p of presets) {
      const btn = el("button", "dra-horizon-btn" + (horizon === p.val ? " dra-selected" : ""), p.label);
      btn.addEventListener("click", () => {
        horizon = p.val;
        savePrefs(storage, { horizon });
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
        savePrefs(storage, { horizon });
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
      const today = todayEt();
      const endDate = addDays(today, horizon);
      const allTargets = getTargetDates({ startDate: today, endDate, selectedDays, existingDates, holidays: HOLIDAYS });
      targetDates = allTargets.slice(0, remaining);
      if (targetDates.length > 0) {
        preview.textContent = targetDates.length + " days to book (" + formatDay(targetDates[0], today) + " to " + formatDay(targetDates[targetDates.length - 1], today) + ")";
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
    backBtn.addEventListener("click", () => renderMain());
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
        todayStr: todayEt(),
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
            entry.textContent = formatDay(result.date) + (result.existing ? " (already booked)" : " booked");
            lastBooked = result.date;
          } else {
            entry.className = "dra-log-entry dra-log-fail";
            entry.textContent = formatDay(result.date) + " FAILED: " + (result.error || "unknown");
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
      const backBtn = el("button", "dra-btn dra-btn-primary", "Back");
      backBtn.style.marginTop = "1rem";
      backBtn.addEventListener("click", () => renderMain());
      panel.appendChild(backBtn);
        return;
    }

    activeAbort = null;
    stopBtn.remove();

    if (lastBooked) {
      saveLastBookedDate(storage, lastBooked);
    }

    progressText.textContent = "Done! " + completed + " days processed.";

    const doneBtn = el("button", "dra-btn dra-btn-primary", "Back");
    doneBtn.style.marginTop = "1rem";
    doneBtn.addEventListener("click", () => renderMain());
    panel.appendChild(doneBtn);
  }

  // Start
  renderMain();
}
