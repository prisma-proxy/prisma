"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { InviteInfoPublic, InviteRedeemResponse } from "@/lib/types";

const INPUT_CLASS =
  "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors";

export default function InviteRedeemClient() {
  const params = useParams();
  const router = useRouter();
  const { login } = useAuth();
  const token = params.token as string;

  const [inviteInfo, setInviteInfo] = useState<InviteInfoPublic | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token || token === "_") return;
    setLoadingInfo(true);
    setInfoError(null);
    api
      .getInviteInfo(token)
      .then((info) => {
        if (!info.valid) {
          setInfoError("This invite link is invalid or has expired.");
        } else {
          setInviteInfo(info);
        }
      })
      .catch(() => {
        setInfoError("This invite link is invalid or has expired.");
      })
      .finally(() => setLoadingInfo(false));
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const result: InviteRedeemResponse = await api.redeemInvite(token, {
        username,
        password,
      });
      login(result.token, result.user, false);
    } catch (err: unknown) {
      const apiErr = err as Error & { status?: number };
      if (apiErr.status === 409) {
        setError("Username is already taken. Please choose a different one.");
      } else if (apiErr.status === 410) {
        setError("This invite link has been fully used and is no longer available.");
      } else {
        setError(apiErr.message || "Registration failed.");
      }
    } finally {
      setLoading(false);
    }
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
              Join Prisma
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              You have been invited to create an account
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6 ring-1 ring-foreground/5 shadow-sm">
          {loadingInfo ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : infoError ? (
            <div className="space-y-4">
              <div
                role="alert"
                className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                {infoError}
              </div>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => router.push("/login/")}
                  className="text-sm text-primary hover:underline"
                >
                  Back to Login
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Invite details */}
              {inviteInfo && (
                <div className="mb-4 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Role</span>
                    <span className="capitalize font-medium">{inviteInfo.default_role}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">Max clients</span>
                    <span className="font-medium">{inviteInfo.max_clients}</span>
                  </div>
                </div>
              )}

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
                    htmlFor="username"
                    className="text-sm font-medium text-foreground"
                  >
                    Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                    autoFocus
                    placeholder="Username"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="password"
                    className="text-sm font-medium text-foreground"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="Password"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="confirmPassword"
                    className="text-sm font-medium text-foreground"
                  >
                    Confirm Password
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="Confirm Password"
                    className={INPUT_CLASS}
                  />
                </div>

                <button
                  type="submit"
                  disabled={
                    loading ||
                    !username.trim() ||
                    !password.trim() ||
                    !confirmPassword.trim()
                  }
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? "Creating account..." : "Create Account"}
                </button>

                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => router.push("/login/")}
                    className="text-sm text-primary hover:underline"
                  >
                    Already have an account? Log in
                  </button>
                </div>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Prisma Console v2.25.0
        </p>
      </div>
    </div>
  );
}
