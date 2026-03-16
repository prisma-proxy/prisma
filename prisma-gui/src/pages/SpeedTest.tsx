import { useState, useCallback } from "react";
import { toast } from "sonner";
import { PlayCircle, StopCircle, ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useStore } from "@/store";
import { api } from "@/lib/commands";

export default function SpeedTest() {
  const speedTestRunning = useStore((s) => s.speedTestRunning);
  const speedTestResult = useStore((s) => s.speedTestResult);
  const setSpeedTestRunning = useStore((s) => s.setSpeedTestRunning);
  const [server,   setServer]   = useState("https://speed.cloudflare.com");
  const [duration, setDuration] = useState(10);

  const handleRun = useCallback(async () => {
    try {
      setSpeedTestRunning(true);
      await api.speedTest(server, duration);
      // Result arrives via prisma://event → speed_test_result
    } catch (e) {
      toast.error(String(e));
      setSpeedTestRunning(false);
    }
  }, [server, duration, setSpeedTestRunning]);

  const handleDurationBlur = useCallback(() => {
    setDuration((d) => Math.max(5, Math.min(60, d)));
  }, []);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="font-bold text-lg">Speed Test</h1>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label>Test server</Label>
          <Input value={server} onChange={(e) => setServer(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Duration (seconds)</Label>
          <Input
            type="number"
            min={5}
            max={60}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            onBlur={handleDurationBlur}
            className="w-24"
          />
        </div>
      </div>

      <Button
        className="w-full"
        variant={speedTestRunning ? "destructive" : "default"}
        disabled={speedTestRunning}
        onClick={handleRun}
      >
        {speedTestRunning ? (
          <><StopCircle /> Running…</>
        ) : (
          <><PlayCircle /> Run Test</>
        )}
      </Button>

      {speedTestRunning && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Testing…</p>
          <Progress value={undefined} className="animate-pulse" />
        </div>
      )}

      {speedTestResult && !speedTestRunning && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
              <ArrowDown className="text-green-400" size={24} />
              <p className="text-2xl font-bold">{speedTestResult.download_mbps.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">Mbps Download</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
              <ArrowUp className="text-blue-400" size={24} />
              <p className="text-2xl font-bold">{speedTestResult.upload_mbps.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">Mbps Upload</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
