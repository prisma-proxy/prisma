"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SpeedTestRunner } from "@/components/speed-test/speed-test-runner";
import { SpeedTestHistory } from "@/components/speed-test/speed-test-history";
import { useSpeedTest } from "@/hooks/use-speed-test";
import { useI18n } from "@/lib/i18n";

export default function SpeedTestPage() {
  const { t } = useI18n();
  const speedTest = useSpeedTest();

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t("speedTest.title")}</h2>

      <Card>
        <CardHeader>
          <CardTitle>{t("speedTest.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SpeedTestRunner speedTest={speedTest} />
        </CardContent>
      </Card>

      {!speedTest.running && speedTest.history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("speedTest.history")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SpeedTestHistory history={speedTest.history} onClear={speedTest.clearHistory} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
