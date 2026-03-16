import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import zhCN from "./zh-CN.json";

// Read persisted language from settings store (localStorage)
function getPersistedLanguage(): string {
  try {
    const raw = localStorage.getItem("prisma-settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.state?.language) return parsed.state.language;
    }
  } catch {}
  return "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: getPersistedLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
