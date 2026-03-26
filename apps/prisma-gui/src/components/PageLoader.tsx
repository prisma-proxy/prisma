import { Loader2 } from "lucide-react";

export default function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="animate-spin text-muted-foreground" size={32} />
    </div>
  );
}
