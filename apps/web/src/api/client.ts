import axios from "axios";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  withCredentials: true, // Crucial for httpOnly cookies
});

// Optionally add interceptors here
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
        window.location.href = "/login";
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
