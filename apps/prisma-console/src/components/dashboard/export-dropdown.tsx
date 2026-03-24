"use client";

import { Download, FileSpreadsheet, FileJson, Image as ImageIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";

interface ExportDropdownProps {
  onCSV?: () => void;
  onJSON?: () => void;
  onPNG?: () => void;
}

export function ExportDropdown({ onCSV, onJSON, onPNG }: ExportDropdownProps) {
  const { t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        <Download className="h-4 w-4" />
        {t("common.export")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8}>
        {onCSV && (
          <DropdownMenuItem onClick={onCSV}>
            <FileSpreadsheet className="h-4 w-4" />
            {t("common.exportCSV")}
          </DropdownMenuItem>
        )}
        {onJSON && (
          <DropdownMenuItem onClick={onJSON}>
            <FileJson className="h-4 w-4" />
            {t("common.exportJSON")}
          </DropdownMenuItem>
        )}
        {onPNG && (
          <DropdownMenuItem onClick={onPNG}>
            <ImageIcon className="h-4 w-4" />
            {t("common.exportPNG")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
