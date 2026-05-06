const PAGES_BASE = "https://nilaybarde.github.io/appspace-desk-reservations/app";
const v = Date.now();

const { extractToken } = await import(`./identity.js?v=${v}`);
const { createApi } = await import(`./api.js?v=${v}`);
const { createApp } = await import(`./ui.js?v=${v}`);

async function init() {
  const identity = extractToken(sessionStorage);
  if (!identity) {
    alert("Log into Appspace first, then click this bookmark again.");
    return;
  }

  const api = createApi(fetch.bind(window), identity.token);

  const valid = await api.verifyToken();
  if (!valid) {
    alert("Your Appspace session has expired. Please refresh the page to re-login, then try again.");
    return;
  }

  let deskLookup;
  try {
    const res = await fetch(PAGES_BASE + "/DESK_LOOKUP.json");
    deskLookup = await res.json();
  } catch {
    alert("Failed to load desk data. Try again in a moment.");
    return;
  }

  const existingStyle = document.getElementById("desk-res-style");
  if (!existingStyle) {
    try {
      const cssRes = await fetch(PAGES_BASE + "/style.css");
      const cssText = await cssRes.text();
      const style = document.createElement("style");
      style.id = "desk-res-style";
      style.textContent = cssText;
      document.head.appendChild(style);
    } catch {
      // CSS load failed — app will still work, just unstyled
    }
  }

  const params = {
    api,
    user: { id: identity.id, name: identity.name, email: identity.email },
    deskLookup,
    storage: localStorage,
  };

  createApp(params);
  window.__deskResToggle = () => createApp(params);
}

init().catch((err) => {
  console.error("[Desk Reservations]", err);
  alert("Something went wrong loading the desk reservation tool. Check the console for details.");
});
