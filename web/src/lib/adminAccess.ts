const STORAGE_KEY = "peach-radio:admin-token";

function readAdminToken(): string {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const incoming = hash.get("admin_token") ?? "";
  try {
    if (incoming) sessionStorage.setItem(STORAGE_KEY, incoming);
    const token = incoming || sessionStorage.getItem(STORAGE_KEY) || "";
    if (incoming) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    return token;
  } catch {
    return incoming;
  }
}

export const peachAdminToken = readAdminToken();
export const hasPeachAdminAccess = () => Boolean(peachAdminToken);
