import axios from "axios";
import { friendlyError } from "@/lib/friendly-error";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  withCredentials: true, // Crucial for httpOnly cookies
});

// Optionally add interceptors here
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // A failed download arrives as a Blob; read it so the server's message is not lost.
    const data = error?.response?.data;
    if (typeof Blob !== "undefined" && data instanceof Blob && data.type.includes("json")) {
      try {
        error.response.data = JSON.parse(await data.text());
      } catch {
        // Not JSON after all; the status alone decides the wording.
      }
    }

    // Every screen that shows err.message now shows plain words, never
    // "Request failed with status code 401".
    if (error && typeof error === "object") error.message = friendlyError(error);

    // /auth/me only asks who is signed in; a 401 there means "nobody", which the
    // portal guard already handles. Redirecting on it would yank logged-out visitors
    // off public pages like the 404.
    const isWhoAmI = error.config?.url === "/auth/me";
    if (error.response && error.response.status === 401 && !isWhoAmI) {
      if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
        // Tell the login page why the person landed there, and bring them back after.
        const here = window.location.pathname + window.location.search;
        window.location.href = `/login?expired=1&redirect=${encodeURIComponent(here)}`;
      }
    }
    return Promise.reject(error);
  }
);

export async function apiFetch<T>(url: string, options?: any): Promise<T> {
  const res = await apiClient(url, options);
  return res.data;
}

export async function apiDownload(url: string, options?: any): Promise<void> {
  const res = await apiClient(url, { ...options, responseType: "blob" });
  const blob = new Blob([res.data]);
  const link = document.createElement("a");
  link.href = window.URL.createObjectURL(blob);
  
  // Try to extract filename from content-disposition
  const disposition = res.headers['content-disposition'];
  let filename = 'download';
  if (disposition && disposition.indexOf('attachment') !== -1) {
    const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
    const matches = filenameRegex.exec(disposition);
    if (matches != null && matches[1]) { 
      filename = matches[1].replace(/['"]/g, '');
    }
  }
  
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
