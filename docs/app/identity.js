export function parseSessionJwt(jwtString) {
  let parts;
  try {
    parts = jwtString.split(".");
    if (parts.length < 2) throw new Error("Not enough JWT segments");
  } catch {
    throw new Error("Failed to parse JWT: could not decode token");
  }

  let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "====".slice(pad);

  let payload;
  try {
    payload = JSON.parse(atob(b64));
  } catch {
    throw new Error("Failed to parse JWT: could not decode payload");
  }

  const user = payload.user;
  if (!user) throw new Error("JWT payload missing user field");

  const token = user.CurrentAccess && user.CurrentAccess.Token;
  if (!token) throw new Error("JWT payload missing token in CurrentAccess");

  const id = (user.UserAccess && user.UserAccess[0] && user.UserAccess[0].UserGuid) || user.UserId;

  return {
    token,
    id,
    name: user.DisplayName,
    email: user.Username,
  };
}

export function extractToken(storage) {
  const jwt = storage.jwt;
  if (!jwt) return null;
  return parseSessionJwt(jwt);
}
