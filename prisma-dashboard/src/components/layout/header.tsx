"use client";

import { useAuth } from "@/lib/auth-context";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const { logout } = useAuth();

  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <h1 className="text-lg font-semibold">{title}</h1>

      <div className="flex items-center gap-4">
        <button
          onClick={logout}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
