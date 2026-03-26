"use client";

import { useState, type FormEvent } from "react";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast-context";

const INPUT_CLASS =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors";

export default function LoginPage() {
  const { login, loginLegacy } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();

  // Login form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  // Legacy token fallback
  const [useLegacyToken, setUseLegacyToken] = useState(false);
  const [token, setToken] = useState("");

  // Registration form state
  const [showRegister, setShowRegister] = useState(false);
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");

  // Advanced section
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiBase, setApiBase] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("prisma-api-base") || ""
      : "",
  );

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** Persist the API base path for all subsequent requests. */
  function persistApiBase(): string {
    const trimmedBase = apiBase.trim().replace(/\/+$/, "");
    if (trimmedBase) {
      localStorage.setItem("prisma-api-base", trimmedBase);
    } else {
      localStorage.removeItem("prisma-api-base");
    }
    return trimmedBase;
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const base = persistApiBase();

    try {
      const result = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (result.ok) {
        const data = await result.json();
        login(data.token, data.user, rememberMe);
      } else if (result.status === 404) {
        // Server does not support user auth -- fall back to token
        setUseLegacyToken(true);
      } else {
        setError(t("auth.invalidCredentials"));
      }
    } catch {
      setError(t("auth.connectionError"));
    } finally {
      setLoading(false);
    }
  }

  async function handleLegacyLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const base = persistApiBase();

    try {
      const res = await fetch(`${base}/api/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        loginLegacy(token);
      } else {
        setError(t("auth.invalidTokenError"));
      }
    } catch {
      setError(t("auth.connectionError"));
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (regPassword !== regConfirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }

    setLoading(true);
    const base = persistApiBase();

    try {
      const res = await fetch(`${base}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: regUsername, password: regPassword }),
      });
      if (res.ok) {
        toast(t("auth.registered"), "success");
        setShowRegister(false);
        setRegUsername("");
        setRegPassword("");
        setRegConfirmPassword("");
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.message || t("auth.registerFailed"));
      }
    } catch {
      setError(t("auth.connectionError"));
    } finally {
      setLoading(false);
    }
  }

  // ---- Render helpers ----

  function renderError() {
    if (!error) return null;
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
      >
        {error}
      </div>
    );
  }

  function renderAdvancedSection() {
    return (
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={showAdvanced}
        >
          {t("auth.advanced")}
          {showAdvanced ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
        {showAdvanced && (
          <div className="mt-3 space-y-2">
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
              className={`${INPUT_CLASS} font-mono`}
            />
            <p className="text-xs text-muted-foreground">
              {t("auth.apiBaseHint")}
            </p>
          </div>
        )}
      </div>
    );
  }

  function renderLoginForm() {
    return (
      <form onSubmit={handleLogin} className="space-y-4">
        {renderError()}

        <div className="space-y-2">
          <label
            htmlFor="username"
            className="text-sm font-medium text-foreground"
          >
            {t("auth.username")}
          </label>
          <input
            id="username"
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
            htmlFor="password"
            className="text-sm font-medium text-foreground"
          >
            {t("auth.password")}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            placeholder={t("auth.password")}
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="rememberMe"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
          />
          <label htmlFor="rememberMe" className="text-sm text-muted-foreground">
            {t("auth.rememberMe")}
          </label>
        </div>

        <button
          type="submit"
          disabled={loading || !username.trim() || !password.trim()}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? t("auth.verifying") : t("auth.login")}
        </button>

        {renderAdvancedSection()}

        <div className="flex items-center justify-between pt-2 text-sm">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setShowRegister(true);
            }}
            className="text-primary hover:underline"
          >
            {t("auth.register")}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setUseLegacyToken(true);
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("auth.useLegacyToken")}
          </button>
        </div>
      </form>
    );
  }

  function renderLegacyTokenForm() {
    return (
      <form onSubmit={handleLegacyLogin} className="space-y-4">
        {renderError()}

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
            className={`${INPUT_CLASS} font-mono`}
          />
          <p className="text-xs text-muted-foreground">
            {t("auth.tokenHint")}
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

        {renderAdvancedSection()}

        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setUseLegacyToken(false);
            }}
            className="text-sm text-primary hover:underline"
          >
            {t("auth.backToLogin")}
          </button>
        </div>
      </form>
    );
  }

  function renderRegisterForm() {
    return (
      <form onSubmit={handleRegister} className="space-y-4">
        {renderError()}

        <p className="text-sm text-muted-foreground">
          {t("auth.registerHint")}
        </p>

        <div className="space-y-2">
          <label
            htmlFor="regUsername"
            className="text-sm font-medium text-foreground"
          >
            {t("auth.username")}
          </label>
          <input
            id="regUsername"
            type="text"
            value={regUsername}
            onChange={(e) => setRegUsername(e.target.value)}
            required
            autoComplete="username"
            autoFocus
            placeholder={t("auth.username")}
            className={INPUT_CLASS}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="regPassword"
            className="text-sm font-medium text-foreground"
          >
            {t("auth.password")}
          </label>
          <input
            id="regPassword"
            type="password"
            value={regPassword}
            onChange={(e) => setRegPassword(e.target.value)}
            required
            autoComplete="new-password"
            placeholder={t("auth.password")}
            className={INPUT_CLASS}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="regConfirmPassword"
            className="text-sm font-medium text-foreground"
          >
            {t("auth.confirmPassword")}
          </label>
          <input
            id="regConfirmPassword"
            type="password"
            value={regConfirmPassword}
            onChange={(e) => setRegConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            placeholder={t("auth.confirmPassword")}
            className={INPUT_CLASS}
          />
        </div>

        <button
          type="submit"
          disabled={
            loading ||
            !regUsername.trim() ||
            !regPassword.trim() ||
            !regConfirmPassword.trim()
          }
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? t("auth.verifying") : t("auth.register")}
        </button>

        {renderAdvancedSection()}

        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setShowRegister(false);
            }}
            className="text-sm text-primary hover:underline"
          >
            {t("auth.backToLogin")}
          </button>
        </div>
      </form>
    );
  }

  // Determine subtitle based on current view
  let subtitle = t("auth.loginSubtitle");
  if (showRegister) subtitle = t("auth.registerSubtitle");
  else if (useLegacyToken) subtitle = t("auth.subtitle");

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
              {t("auth.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        {/* Form */}
        <div className="rounded-xl border bg-card p-6 ring-1 ring-foreground/5 shadow-sm">
          {showRegister
            ? renderRegisterForm()
            : useLegacyToken
              ? renderLegacyTokenForm()
              : renderLoginForm()}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Prisma Console v2.18.0
        </p>
      </div>
    </div>
  );
}
