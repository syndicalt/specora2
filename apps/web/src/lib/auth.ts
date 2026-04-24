const TOKEN_KEY = "specora_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getUserRole(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    // Fix base64url -> base64: replace chars and add padding
    let base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const pad = 4 - (base64.length % 4);
    if (pad !== 4) base64 += "=".repeat(pad === 4 ? 0 : pad);
    const decoded = JSON.parse(atob(base64));
    return decoded.role || null;
  } catch {
    return null;
  }
}
