import axios from "axios";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3001/api",
  withCredentials: true, // Crucial for httpOnly cookies
});

// Optionally add interceptors here
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // If we want to globally handle 401s, we can trigger a logout or redirect
    return Promise.reject(error);
  }
);
