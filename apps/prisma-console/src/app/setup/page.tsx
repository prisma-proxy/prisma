"use client";

import { useState, useEffect, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { getSetupStatus, setupInit } from "@/lib/api";
import { useRouter } from "next/navigation";

const INPUT_CLASS =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors";

export default function SetupPage() {
  const { login } = useAuth();
  const { t } = useI18n();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // On mount, verify that setup is actually needed
  useEffect(() => {
    getSetupStatus()
      .then(({ needs_setup }) => {
        if (!needs_setup) {
          router.replace("/login/");
        } else {
          setChecking(false);
        }
      })
      .catch(() => {
        // Cannot reach server — let user stay on setup page
        setChecking(false);
      });
  }, [router]);

  const passwordTooShort = password.length > 0 && password.length < 8;
  const passwordsMismatch =
    confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit =
    !loading &&
    username.trim().length > 0 &&
    password.length >= 8 &&
    password === confirmPassword;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t("setup.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      const data = await setupInit({ username, password });
      login(data.token, data.user, true);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === "Setup already complete") {
          setError(t("setup.alreadyComplete"));
          setTimeout(() => router.replace("/login/"), 2000);
          return;
        }
        setError(err.message);
      } else {
        setError("Setup failed");
      }
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary overflow-hidden">
            <img src="/favicon.ico" className="h-10 w-10" alt="Prisma" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {t("setup.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("setup.subtitle")}
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="rounded-xl border bg-card p-6 ring-1 ring-foreground/5 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label
                htmlFor="setup-username"
                className="text-sm font-medium text-foreground"
              >
                {t("auth.username")}
              </label>
              <input
                id="setup-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                autoFocus
                placeholder={t("auth.username")}
                className={INPUT_CLASS}
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="setup-password"
                className="text-sm font-medium text-foreground"
              >
                {t("auth.password")}
              </label>
              <input
                id="setup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder={t("auth.password")}
                className={INPUT_CLASS}
              />
              {passwordTooShort && (
                <p className="text-xs text-destructive">
                  {t("setup.passwordTooShort")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="setup-confirm-password"
                className="text-sm font-medium text-foreground"
              >
                {t("auth.confirmPassword")}
              </label>
              <input
                id="setup-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder={t("auth.confirmPassword")}
                className={INPUT_CLASS}
              />
              {passwordsMismatch && (
                <p className="text-xs text-destructive">
                  {t("auth.passwordMismatch")}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? t("setup.creating") : t("setup.createAdmin")}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Prisma Console v2.9.0
        </p>
      </div>
    </div>
  );
}
