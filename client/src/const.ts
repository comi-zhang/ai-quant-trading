export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Login API
export const login = async (username: string, password: string) => {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Login failed");
  }
  
  return response.json();
};

export const logout = async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.reload();
};

// For OAuth compatibility - redirect to login page
export const getLoginUrl = () => {
  return "/login";
};
