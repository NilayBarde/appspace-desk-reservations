import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSessionJwt, extractToken } from "../../docs/app/identity.js";

function makeJwt(payload) {
  const header = btoa(JSON.stringify({ alg: "HS256" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe("parseSessionJwt", () => {
  it("extracts token, userId, name, email from valid JWT", () => {
    const jwt = makeJwt({
      user: {
        CurrentAccess: { Token: "abc-token-123" },
        UserId: "user-guid-456",
        DisplayName: "Jane Smith",
        Username: "jane.smith@disney.com",
      },
    });
    const result = parseSessionJwt(jwt);
    assert.equal(result.token, "abc-token-123");
    assert.equal(result.id, "user-guid-456");
    assert.equal(result.name, "Jane Smith");
    assert.equal(result.email, "jane.smith@disney.com");
  });

  it("throws on JWT with no user field", () => {
    const jwt = makeJwt({ other: "data" });
    assert.throws(() => parseSessionJwt(jwt), /user/i);
  });

  it("throws on JWT with missing token", () => {
    const jwt = makeJwt({
      user: { UserId: "id", DisplayName: "X", Username: "x@y.com" },
    });
    assert.throws(() => parseSessionJwt(jwt), /token/i);
  });

  it("throws on malformed JWT string", () => {
    assert.throws(() => parseSessionJwt("not-a-jwt"), /parse|decode/i);
  });

  it("handles base64url encoding (- and _ chars)", () => {
    const payload = { user: { CurrentAccess: { Token: "tk" }, UserId: "id", DisplayName: "N", Username: "e" } };
    const body = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const jwt = `header.${body}.sig`;
    const result = parseSessionJwt(jwt);
    assert.equal(result.token, "tk");
  });
});

describe("extractToken", () => {
  it("reads JWT from sessionStorage mock", () => {
    const mockStorage = { jwt: makeJwt({
      user: { CurrentAccess: { Token: "t" }, UserId: "u", DisplayName: "N", Username: "e" },
    })};
    const result = extractToken(mockStorage);
    assert.equal(result.token, "t");
  });

  it("returns null when no JWT in storage", () => {
    const result = extractToken({});
    assert.equal(result, null);
  });
});
