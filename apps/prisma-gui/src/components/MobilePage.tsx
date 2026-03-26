import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface MobilePageProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}

export default function MobilePage({ title, actions, children }: MobilePageProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h1 className="font-bold text-lg">{title}</h1>
        {actions && <div className="flex gap-1">{actions}</div>}
      </div>
      <ScrollArea className="flex-1">
        <div className="px-4 pb-20">
          {children}
        </div>
      </ScrollArea>
    </div>
  );
}
