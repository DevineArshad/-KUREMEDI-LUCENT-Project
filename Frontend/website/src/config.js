/**
 * API config - matches app config. Use same backend as React Native app.
 */
const isDevelopment = process.env.NODE_ENV !== "production";
const defaultApiBase = isDevelopment
  ? "http://localhost:5000/api"
  : "https://backend.kuremedi.com/api";

let API_BASE = process.env.NEXT_PUBLIC_API_URL || defaultApiBase;

// Normalize common mistakes from env (like `https:/.kuremedi.com/api`)
API_BASE = API_BASE.trim();
API_BASE = API_BASE.replace("https:/.kuremedi.com", "https://backend.kuremedi.com");
API_BASE = API_BASE.replace("https:/.kuremcdi.com", "https://backend.kuremedi.com");
API_BASE = API_BASE.replace("api.kuremedi.com", "backend.kuremedi.com");
API_BASE = API_BASE.replace("backend.kuremcdi.com", "backend.kuremedi.com"); // Fix typo variant
// Force HTTPS for public backend host to avoid mixed-content failures on HTTPS website.
API_BASE = API_BASE.replace(/^http:\/\/backend\.kuremedi\.com/i, "https://backend.kuremedi.com");

// Protect production builds from misconfigured env values like localhost API.
if (!isDevelopment && /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(API_BASE)) {
  API_BASE = "https://backend.kuremedi.com/api";
}

// Ensure API path consistently ends with /api
if (!/\/api\/?$/i.test(API_BASE)) {
  API_BASE = API_BASE.replace(/\/+$/, "") + "/api";
}

export const API_BASE_URL = API_BASE;
// If API is relative (/api), uploads should also be relative (/uploads).
// If API is absolute, drop trailing /api so uploads use same backend host.
export const API_UPLOAD_BASE =
  process.env.NEXT_PUBLIC_UPLOAD_BASE ||
  (API_BASE_URL.startsWith("/")
    ? API_BASE_URL.replace(/\/api\/?$/, "") || "/"
    : API_BASE_URL.replace(/\/api\/?$/, "")) ||
  (isDevelopment ? "http://localhost:5000" : "https://backend.kuremedi.com");
