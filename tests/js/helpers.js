export function createMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem(key) { return store[key] ?? null; },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    get _store() { return store; },
  };
}

export function createMockFetch(handlers) {
  return async function mockFetch(url, options = {}) {
    for (const handler of handlers) {
      const match = handler.match(url, options);
      if (match) {
        return {
          ok: match.status >= 200 && match.status < 300,
          status: match.status,
          json: async () => match.body,
        };
      }
    }
    throw new Error(`Unhandled fetch: ${options.method || "GET"} ${url}`);
  };
}

export function urlContains(substring) {
  return (url) => url.includes(substring);
}

export function methodAndUrl(method, substring) {
  return {
    match(url, options) {
      if ((options.method || "GET") === method && url.includes(substring)) {
        return this._response;
      }
      return null;
    },
    responding(status, body) {
      this._response = { status, body };
      return this;
    },
  };
}
