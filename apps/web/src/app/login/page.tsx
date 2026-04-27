"use client";

import { useEffect, useState } from "react";
import { setAuthTokens } from "@/lib/auth";
import { API_BASE } from "@/lib/api";

type Provider = { id: string; name: string };

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const handoff = hash.get("handoff");
    if (handoff) {
      fetch(`${API_BASE}/api/auth/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: handoff }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Login handoff failed");
          setAuthTokens({ token: data.token, refreshToken: data.refreshToken });
          window.history.replaceState(null, "", data.returnTo || "/");
          window.location.href = data.returnTo || "/";
        })
        .catch((err) => setError(err.message || "Login handoff failed"));
      return;
    }
    const token = hash.get("token");
    const refreshToken = hash.get("refreshToken");
    if (token && refreshToken) {
      setAuthTokens({ token, refreshToken });
      window.history.replaceState(null, "", "/");
      window.location.href = "/";
      return;
    }

    fetch(`${API_BASE}/api/auth/oauth/providers`, { cache: "no-store" })
      .then((res) => res.ok ? res.json() : { providers: [] })
      .then((data) => setProviders(data.providers || []))
      .catch(() => setProviders([]));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      setAuthTokens({ token: data.token, refreshToken: data.refreshToken });
      window.location.href = "/";
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const startOAuth = (provider: string) => {
    window.location.href = `${API_BASE}/api/auth/oauth/${provider}/start?returnTo=/`;
  };

  const startSso = async () => {
    setError("");
    if (!email) {
      setError("Enter your email address to discover SSO.");
      return;
    }
    setSsoLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/sso/discover?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (!res.ok || !data.sso || !data.startUrl) throw new Error("No SSO provider is configured for this email domain.");
      window.location.href = `${data.startUrl}?returnTo=${encodeURIComponent("/")}`;
    } catch (err: any) {
      setError(err.message || "SSO discovery failed");
    } finally {
      setSsoLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4 text-gray-100">
      <form onSubmit={handleLogin} className="w-full max-w-md rounded-lg border border-gray-800 bg-gray-900 p-8 shadow-2xl">
        <div className="mb-7">
          <p className="text-sm uppercase tracking-[0.2em] text-cyan-300">Specora</p>
          <h1 className="mt-2 text-3xl font-semibold">Sign in</h1>
          <p className="mt-2 text-sm text-gray-400">Use your platform account or a configured enterprise identity provider.</p>
        </div>
        {error && (
          <div className="mb-4 rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
        <div className="mb-4">
          <label className="mb-1 block text-sm text-gray-300">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-cyan-400"
            required
          />
        </div>
        <div className="mb-5">
          <label className="mb-1 block text-sm text-gray-300">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-cyan-400"
            required
          />
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded bg-cyan-400 px-4 py-2 font-semibold text-gray-950 hover:bg-cyan-300 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
          <button
            type="button"
            onClick={startSso}
            disabled={ssoLoading}
            className="rounded border border-gray-700 px-4 py-2 font-medium text-gray-200 hover:border-cyan-400 disabled:opacity-50"
          >
            {ssoLoading ? "Checking..." : "SSO"}
          </button>
        </div>
        {providers.length > 0 && (
          <div className="mt-6 border-t border-gray-800 pt-5">
            <div className="grid gap-2">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => startOAuth(provider.id)}
                  className="rounded border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:border-cyan-400"
                >
                  Continue with {provider.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
