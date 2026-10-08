import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import { APP_LOCALES, sharedI18n } from "../../../../shared/i18n";
import { I18nContext } from "../I18nContext";
import DataPane from "./DataPane";

vi.stubGlobal("hermesAPI", {
  cloudWorkspace: {
    status: async () => ({ userId: null, enabled: false }),
    executionReview: { list: vi.fn(), review: vi.fn() },
  },
});

const settings = vi.hoisted(() => ({
  backingUp: false,
  backupResult: null,
  importing: false,
  importResult: null,
  handleBackup: vi.fn(),
  handleImport: vi.fn(),
  openclawFound: true,
  openclawPath: "",
  migrationDismissed: false,
  migrating: false,
  migrationLog: null,
  migrationResult: null,
  migrationResultType: null,
  migrationLogRef: { current: null },
  handleMigrate: vi.fn(),
  handleDismissMigration: vi.fn(),
}));

vi.mock("./SettingsDataContext", () => ({ useSettings: () => settings }));

describe.each(APP_LOCALES)("Cloud original DataPane (%s)", (locale) => {
  // @lat: [[sidebar-navigation#Settings modal#Migration path rendering]]
  it("uses shared cloud controls without displaying legacy paths or migration actions", () => {
    settings.openclawPath = '/home/<img src=x onerror="alert(1)">/.openclaw';
    const i18n = sharedI18n.cloneInstance({
      lng: locale,
      initImmediate: false,
    });
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <I18nContext.Provider value={{ locale, setLocale: vi.fn() }}>
          <DataPane />
        </I18nContext.Provider>
      </I18nextProvider>,
    );
    expect(container.querySelector(".settings-migration-desc")).toBeNull();
    expect(container.textContent).not.toContain(settings.openclawPath);
    const buttons = Array.from(
      container.querySelectorAll(".settings-hermes-actions button"),
    ) as HTMLButtonElement[];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });
});
