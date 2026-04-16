import { API_BASE_CANDIDATES } from "../config";

const getToken = () => (typeof window !== "undefined" ? localStorage.getItem("token") : null);

function buildAuthHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function forceLogoutIfBlocked(status, data) {
  if (typeof window === "undefined") return;
  const hasToken = !!localStorage.getItem("token");
  if (!hasToken) return;

  const message = String(data?.message || "").toLowerCase();
  const isBlocked = status === 403 && message.includes("blocked");
  const isUnauthorized = status === 401;

  if (!isBlocked && !isUnauthorized) return;

  if (isBlocked && data?.message) {
    try {
      sessionStorage.setItem("blocked_message", String(data.message));
    } catch (_) {}
  }

  localStorage.removeItem("token");
  localStorage.removeItem("user");
  if (window.location.pathname !== "/login") {
    window.location.href = isBlocked ? "/login?blocked=1" : "/login";
  }
}

function isNetworkFailure(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("networkerror")
  );
}

async function fetchWithFallback(path, init = {}) {
  const bases = Array.isArray(API_BASE_CANDIDATES) ? API_BASE_CANDIDATES : [];
  let lastError = null;

  for (const base of bases) {
    try {
      return await fetch(`${base}${path}`, init);
    } catch (error) {
      lastError = error;
      if (!isNetworkFailure(error)) {
        throw error;
      }
    }
  }

  if (lastError) {
    const error = new Error(
      `Network request failed after trying ${bases.length} API host(s). Check backend availability and NEXT_PUBLIC_API_URL.`
    );
    error.cause = lastError;
    throw error;
  }

  throw new Error("No API base URL configured");
}

async function parseResponse(res) {
  const raw = await res.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };
    }
  }

  if (!res.ok) {
    forceLogoutIfBlocked(res.status, data);
    const error = new Error(data?.message || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

export async function apiGet(path) {
  const res = await fetchWithFallback(path, {
    headers: {
      ...buildAuthHeader(),
    },
  });
  return parseResponse(res);
}

export async function apiPost(path, body) {
  const res = await fetchWithFallback(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeader(),
    },
    body: JSON.stringify(body),
  });
  return parseResponse(res);
}

export async function apiPut(path, body) {
  const res = await fetchWithFallback(path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeader(),
    },
    body: JSON.stringify(body),
  });
  return parseResponse(res);
}

export async function apiDelete(path) {
  const res = await fetchWithFallback(path, {
    method: "DELETE",
    headers: {
      ...buildAuthHeader(),
    },
  });
  return parseResponse(res);
}
