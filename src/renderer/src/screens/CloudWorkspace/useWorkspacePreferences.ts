import { useCallback } from "react";
import { useFont } from "../../components/FontProvider";
import { useChatPreferences } from "../../components/ChatPreferencesProvider";
import { THEMES, FONT_OPTIONS } from "../../constants";
import { setAnalyticsConsent } from "../../utils/analytics";
import { useTheme } from "../../components/ThemeProvider";
import { useI18n } from "../../components/useI18n";
import { APP_LOCALES, type AppLocale } from "../../../../shared/i18n";

/** Applies confirmed cloud preferences through the original Desktop providers. */
export function useWorkspacePreferences(): (
  data: Record<string, unknown>,
) => void {
  const chat = useChatPreferences();
  const { setTheme, setRounded } = useTheme();
  const { setFont } = useFont();
  const { setLocale } = useI18n();
  const preferences = useCallback(
    (data: Record<string, unknown>): void => {
      if (
        typeof data.theme === "string" &&
        (data.theme === "system" ||
          THEMES.some((theme) => theme.id === data.theme))
      )
        setTheme(data.theme);
      if (
        typeof data.font === "string" &&
        FONT_OPTIONS.some((font) => font.value === data.font)
      )
        setFont(data.font);
      if (typeof data.rounded === "boolean") setRounded(data.rounded);
      if (typeof data.completionSoundEnabled === "boolean")
        chat.setCompletionSoundEnabled(data.completionSoundEnabled);
      if (typeof data.spellcheckEnabled === "boolean")
        chat.setSpellcheckEnabled(data.spellcheckEnabled);
      if (typeof data.spellcheckUseSystemLanguages === "boolean")
        chat.setSpellcheckUseSystemLanguages(data.spellcheckUseSystemLanguages);
      if (
        Array.isArray(data.spellcheckLanguages) &&
        data.spellcheckLanguages.every(
          (language) => typeof language === "string",
        )
      )
        chat.setSpellcheckLanguages(data.spellcheckLanguages);
      if (typeof data.analyticsEnabled === "boolean")
        setAnalyticsConsent(data.analyticsEnabled);
      if (
        typeof data.locale === "string" &&
        (APP_LOCALES as readonly string[]).includes(data.locale)
      )
        setLocale(data.locale as AppLocale);
    },
    [setTheme, setLocale, setRounded, setFont, chat],
  );
  return preferences;
}
