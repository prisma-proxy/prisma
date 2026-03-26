import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { usePlatform } from "@/hooks/usePlatform";
import { useFeatures } from "@/lib/features";
import AppearanceSection from "./settings/AppearanceSection";
import GeneralSection from "./settings/GeneralSection";
import ProxyPortsSection from "./settings/ProxyPortsSection";
import DnsSection from "./settings/DnsSection";
import LoggingSection from "./settings/LoggingSection";
import TunSection from "./settings/TunSection";
import MobileSection from "./settings/MobileSection";
import RoutingSection from "./settings/RoutingSection";
import SplitTunnelingSection from "./settings/SplitTunnelingSection";
import AutoReconnectSection from "./settings/AutoReconnectSection";
import PerformanceSection from "./settings/PerformanceSection";
import DataManagementSection from "./settings/DataManagementSection";
import UpdatesSection from "./settings/UpdatesSection";
import AboutSection from "./settings/AboutSection";

export default function Settings() {
  const { t } = useTranslation();
  const { isMobile } = usePlatform();
  const features = useFeatures();

  return (
    <ScrollArea className="h-full">
      <div className="p-4 sm:p-6 pb-12 space-y-6 max-w-2xl">
        <h1 className="font-bold text-lg">{t("settings.title")}</h1>

        {/* Mobile settings first on mobile */}
        {isMobile && (
          <>
            <MobileSection />
            <Separator />
          </>
        )}

        <AppearanceSection />
        <Separator />

        {/* Desktop-only: start on boot, minimize to tray */}
        {features.hasAutostart && (
          <>
            <GeneralSection />
            <Separator />
          </>
        )}

        <ProxyPortsSection />
        <Separator />

        <DnsSection />
        <Separator />

        <LoggingSection />
        <Separator />

        <TunSection />

        {/* Mobile settings on desktop (at original position) */}
        {!isMobile && isMobile === false && null}

        <Separator />
        <RoutingSection />

        <Separator />
        <SplitTunnelingSection />

        <Separator />
        <AutoReconnectSection />

        <Separator />
        <PerformanceSection />

        <Separator />
        <DataManagementSection />

        <Separator />
        <UpdatesSection />

        <Separator />
        <AboutSection />
      </div>
    </ScrollArea>
  );
}
