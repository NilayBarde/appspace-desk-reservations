const PAGES_BASE = "https://nilaybarde.github.io/appspace-desk-reservations/app";
const v = Date.now();

// The bookmark only redirects off Appspace and loads this file, so behaviour
// lives here, where changes reach users without them re-dragging the bookmark.
const open = document.getElementById("desk-res-app");
if (open) {
  // Clicking while the panel is open closes it, asking first if work is running.
  open.dispatchEvent(new CustomEvent("desk-res-close"));
} else if (!window.__deskResLoading) {
  // Ignore repeat clicks while a load is still waiting for the session.
  window.__deskResLoading = true;
  init()
    .catch((err) => {
      console.error("[Desk Reservations]", err);
      alert("Something went wrong loading the desk reservation tool. Check the console for details.");
    })
    .finally(() => {
      window.__deskResLoading = false;
    });
}

async function init() {
  const { extractToken, waitForIdentity } = await import(`./identity.js?v=${v}`);
  const { createApi } = await import(`./api.js?v=${v}`);
  const { createApp } = await import(`./ui.js?v=${v}`);

  // Right after login Appspace may not have written the session yet.
  const identity = await waitForIdentity(sessionStorage);
  if (!identity) {
    alert("Log into Appspace first, then click this bookmark again.");
    return;
  }

  // Read the session on every request so a token Appspace refreshes in the
  // background is used; fall back to the one read at open if it can't be parsed.
  const api = createApi(fetch.bind(window), () => {
    try {
      return (extractToken(sessionStorage) || identity).token;
    } catch {
      return identity.token;
    }
  });

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
  if (existingStyle) existingStyle.remove();
  try {
    const cssRes = await fetch(PAGES_BASE + "/style.css?v=" + v);
    const cssText = await cssRes.text();
    const style = document.createElement("style");
    style.id = "desk-res-style";
    style.textContent = cssText;
    document.head.appendChild(style);
  } catch {
    // CSS load failed — app will still work, just unstyled
  }

  const params = {
    api,
    user: { id: identity.id, name: identity.name, email: identity.email },
    deskLookup,
    storage: localStorage,
  };

  createApp(params);
}
