const KEY = "loaner_token";

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (token) => (token ? localStorage.setItem(KEY, token) : localStorage.removeItem(KEY));

/**
 * JSON call. `raw` sends a Blob as is (photo upload). Throws Error with .status on a failure.
 * A 401 on a signed-in call means the device token is gone, so the app returns to the welcome screen.
 */
export async function api(method, path, body, raw) {
  const headers = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (raw) {
    payload = raw;
    headers["content-type"] = raw.type;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new Error("Cannot reach Loan some. Check your connection.");
  }
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith("/api/auth/")) {
      setToken(null);
      location.replace("/");
    }
    const error = new Error((data && data.error) || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

/** The photo as a blob. Needs the bearer token, so an <img src> cannot fetch it. */
export async function fetchBlob(path) {
  const res = await fetch(path, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) return null;
  return res.blob();
}
