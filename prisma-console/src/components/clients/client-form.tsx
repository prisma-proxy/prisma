"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";

interface ClientFormProps {
  onSubmit: (name: string) => void;
  isLoading: boolean;
}

export function ClientForm({ onSubmit, isLoading }: ClientFormProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(name.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-3">
      <div className="grid w-full max-w-sm gap-1.5">
        <Label htmlFor="client-name">{t("clients.clientName")}</Label>
        <Input
          id="client-name"
          type="text"
          placeholder={t("clients.enterClientName")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={isLoading}>
        {isLoading ? t("clients.creating") : t("clients.createClient")}
      </Button>
    </form>
  );
}
