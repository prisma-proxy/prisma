"use client";

import { useState, type FormEvent } from "react";
import { Shield, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [apiBase, setApiBase] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("prisma-api-base") || ""
      : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Persist the API base path before making the validation request
    const trimmedBase = apiBase.trim().replace(/\/+$/, "");
    if (trimmedBase) {
      localStorage.setItem("prisma-api-base", trimmedBase);
    } else {
      localStorage.removeItem("prisma-api-base");
    }

    try {
      // Validate the token by calling the health endpoint
      const base = trimmedBase;
      const res = await fetch(`${base}/api/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        login(token);
      } else {
        setError(t("auth.invalidTokenError"));
      }
    } catch {
      setError(t("auth.connectionError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <Shield className="h-7 w-7 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {t("auth.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("auth.subtitle")}
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="rounded-xl border bg-card p-6 ring-1 ring-foreground/5 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label
                htmlFor="token"
                className="text-sm font-medium text-foreground"
              >
                {t("auth.apiToken")}
              </label>
              <input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                autoComplete="off"
                autoFocus
                placeholder={t("auth.tokenInputPlaceholder")}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              />
              <p className="text-xs text-muted-foreground">
                {t("auth.tokenHint")}
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="apiBase"
                className="text-sm font-medium text-foreground"
              >
                {t("auth.apiBase")}
              </label>
              <input
                id="apiBase"
                type="text"
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                autoComplete="off"
                placeholder="/prisma-mgmt"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              />
              <p className="text-xs text-muted-foreground">
                {t("auth.apiBaseHint")}
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !token.trim()}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? t("auth.verifying") : t("auth.signIn")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
