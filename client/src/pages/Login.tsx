import { useState } from "react";
import { login } from "@/const";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(username, password);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#0f0f0f",
      color: "#fff"
    }}>
      <form onSubmit={handleSubmit} style={{
        padding: "40px",
        background: "#1a1a1a",
        borderRadius: "12px",
        width: "320px"
      }}>
        <h1 style={{ marginBottom: "24px", textAlign: "center" }}>Sign In</h1>
        
        {error && (
          <div style={{ 
            color: "#ff4444", 
            marginBottom: "16px", 
            padding: "8px",
            background: "rgba(255,68,68,0.1)",
            borderRadius: "4px"
          }}>
            {error}
          </div>
        )}

        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "16px",
            background: "#2a2a2a",
            border: "1px solid #333",
            borderRadius: "6px",
            color: "#fff",
            fontSize: "14px"
          }}
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "24px",
            background: "#2a2a2a",
            border: "1px solid #333",
            borderRadius: "6px",
            color: "#fff",
            fontSize: "14px"
          }}
          required
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px",
            background: "#3b82f6",
            border: "none",
            borderRadius: "6px",
            color: "#fff",
            fontSize: "14px",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
