import { useEffect, useState } from "react";

interface BatteryState {
  level: number;
  charging: boolean;
}

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  addEventListener(type: "levelchange" | "chargingchange", listener: () => void): void;
  removeEventListener(type: "levelchange" | "chargingchange", listener: () => void): void;
}

declare global {
  interface Navigator {
    getBattery?: () => Promise<BatteryManager>;
  }
}

export function useBattery(): BatteryState {
  const [state, setState] = useState<BatteryState>({ level: -1, charging: false });

  useEffect(() => {
    if (!navigator.getBattery) return;

    let battery: BatteryManager | null = null;

    function update() {
      if (!battery) return;
      setState({
        level: Math.round(battery.level * 100),
        charging: battery.charging,
      });
    }

    navigator.getBattery().then((b) => {
      battery = b;
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    }).catch(() => {});

    return () => {
      if (battery) {
        battery.removeEventListener("levelchange", update);
        battery.removeEventListener("chargingchange", update);
      }
    };
  }, []);

  return state;
}
