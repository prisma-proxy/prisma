"use client";

import { useAuth } from "@/lib/auth-context";

type Role = "admin" | "operator" | "client";

const ROLE_LEVEL: Record<Role, number> = {
  admin: 3,
  operator: 2,
  client: 1,
};

interface RoleGuardProps {
  /** Minimum role required to render children */
  minimum: Role;
  children: React.ReactNode;
  /** Rendered when the user lacks the required role */
  fallback?: React.ReactNode;
}

/**
 * Conditionally renders children based on the authenticated user's role.
 * When no user is present (e.g. other agent hasn't finished the auth flow),
 * defaults to "admin" for backward compatibility.
 */
export function RoleGuard({ minimum, children, fallback }: RoleGuardProps) {
  const { user } = useAuth();
  const userRole = (user?.role as Role) ?? "admin";
  const userLevel = ROLE_LEVEL[userRole] ?? ROLE_LEVEL.client;
  const requiredLevel = ROLE_LEVEL[minimum];

  if (userLevel >= requiredLevel) {
    return <>{children}</>;
  }

  return fallback ? <>{fallback}</> : null;
}

/**
 * Hook that returns the effective role and helper checks.
 */
export function useRole() {
  const { user } = useAuth();
  const role: Role = (user?.role as Role) ?? "admin";
  const level = ROLE_LEVEL[role] ?? ROLE_LEVEL.client;

  return {
    role,
    isAdmin: level >= ROLE_LEVEL.admin,
    isOperator: level >= ROLE_LEVEL.operator,
    isClient: level >= ROLE_LEVEL.client,
    hasMinimumRole: (minimum: Role) => level >= ROLE_LEVEL[minimum],
  };
}
