const isDev = import.meta.env.DEV;

let rawBase =
  import.meta.env.VITE_BASE_URL ||
  (isDev ? "http://localhost:5000/api" : "https://backend.kuremedi.com/api");

rawBase = String(rawBase || "").trim();
// Normalize common domain typos and mistakes
rawBase = rawBase.replace("https:/.kuremedi.com", "https://backend.kuremedi.com");
rawBase = rawBase.replace("https:/.kuremcdi.com", "https://backend.kuremedi.com");
rawBase = rawBase.replace("backend.kuremcdi.com", "backend.kuremedi.com");

export const ADMIN_API_BASE_URL = rawBase.replace(/\/$/, "");
export const ADMIN_UPLOAD_BASE_URL = ADMIN_API_BASE_URL.replace(/\/api\/?$/, "");

export const resolveUploadUrl = (value) => {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (raw.startsWith("http") || raw.startsWith("blob:") || raw.startsWith("data:")) {
    return raw;
  }
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${ADMIN_UPLOAD_BASE_URL}/${normalized}`;
};
