"use client";

import { useMemo } from "react";

export type Rule = "port" | "address" | "cidr" | "hex" | "required";

const PORT_RE = /^\d+$/;
const ADDRESS_RE = /^.+:\d+$/;
const IPV4_CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV6_CIDR_RE = /^[0-9a-fA-F:]+\/\d{1,3}$/;
const HEX_RE = /^[0-9a-fA-F]*$/;

function validateRule(value: string, rule: Rule): string | null {
  switch (rule) {
    case "required":
      if (!value.trim()) return "This field is required";
      return null;

    case "port": {
      if (!value.trim()) return null;
      if (!PORT_RE.test(value)) return "Must be a valid port number (1-65535)";
      const num = parseInt(value, 10);
      if (num < 1 || num > 65535) return "Port must be between 1 and 65535";
      return null;
    }

    case "address": {
      if (!value.trim()) return null;
      if (!ADDRESS_RE.test(value)) return "Must be in host:port format";
      const portStr = value.split(":").pop();
      if (portStr) {
        const port = parseInt(portStr, 10);
        if (isNaN(port) || port < 1 || port > 65535)
          return "Port must be between 1 and 65535";
      }
      return null;
    }

    case "cidr": {
      if (!value.trim()) return null;
      if (!IPV4_CIDR_RE.test(value) && !IPV6_CIDR_RE.test(value))
        return "Must be a valid CIDR (e.g., 10.0.0.0/8 or ::1/128)";
      return null;
    }

    case "hex": {
      if (!value.trim()) return null;
      if (!HEX_RE.test(value)) return "Must contain only hex characters (0-9, a-f)";
      if (value.length % 2 !== 0) return "Hex string must have even length";
      return null;
    }

    default:
      return null;
  }
}

export function useValidation(
  value: string,
  rules: Rule[]
): { error: string | null } {
  const error = useMemo(() => {
    for (const rule of rules) {
      const result = validateRule(value, rule);
      if (result) return result;
    }
    return null;
  }, [value, rules]);

  return { error };
}
