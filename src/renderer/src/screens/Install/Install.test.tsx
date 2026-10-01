import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const i18nState = vi.hoisted(() => ({
  t: (key: string): string => `en:${key}`,
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: i18nState.t }),
}));

import Install from "./Install";

describe("Install", () => {
  beforeEach(() => {
    i18nState.t = (key: string): string => `en:${key}`;
  });

  // @lat: [[onboarding#Install confirm + progress#Single-run installation]]
  it("does not restart an active installation when translations change", async () => {
    let resolveInstall!: (result: { success: boolean; error?: string }) => void;
    const startInstall = vi.fn(
      () =>
        new Promise<{ success: boolean; error?: string }>((resolve) => {
          resolveInstall = resolve;
        }),
    );
    const removeProgressListener = vi.fn();

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        inspectInstallTarget: vi.fn().mockResolvedValue({
          hermesHome: "/tmp/hermes",
          repoPath: "/tmp/hermes/hermes-agent",
          state: "fresh",
        }),
        onInstallProgress: vi.fn(() => removeProgressListener),
        startInstall,
        cancelInstall: vi.fn().mockResolvedValue(true),
      },
    });

    const props = {
      onComplete: vi.fn(),
      onFailed: vi.fn(),
      onCancel: vi.fn(),
    };
    const view = render(<Install {...props} />);

    fireEvent.click(screen.getByText("en:install.confirmInstallBtn"));
    await waitFor(() => expect(startInstall).toHaveBeenCalledTimes(1));

    i18nState.t = (key: string): string => `fr:${key}`;
    view.rerender(<Install {...props} />);

    expect(startInstall).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveInstall({ success: false });
      await Promise.resolve();
    });

    expect(startInstall).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("fr:install.retryInstallation"));
    expect(props.onFailed).toHaveBeenCalledWith(
      "fr:install.installationFailedHint",
    );
  });

  it("cancels a deferred idle wait, but disables cancel after maintenance begins", async () => {
    let progressListener!: (progress: {
      step: number;
      totalSteps: number;
      title: string;
      detail: string;
      log: string;
      cancellable?: boolean;
    }) => void;
    const cancelInstall = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        inspectInstallTarget: vi.fn().mockResolvedValue({
          hermesHome: "/tmp/hermes",
          repoPath: "/tmp/hermes/hermes-agent",
          state: "update",
        }),
        onInstallProgress: vi.fn((listener) => {
          progressListener = listener;
          return vi.fn();
        }),
        startInstall: vi.fn(() => new Promise(() => undefined)),
        cancelInstall,
      },
    });
    const props = {
      onComplete: vi.fn(),
      onFailed: vi.fn(),
      onCancel: vi.fn(),
    };
    render(<Install {...props} />);
    fireEvent.click(screen.getByText("en:install.confirmInstallBtn"));
    await waitFor(() => expect(progressListener).toBeDefined());

    act(() => {
      progressListener({
        step: 1,
        totalSteps: 7,
        title: "waiting",
        detail: "waiting",
        log: "waiting",
        cancellable: true,
      });
    });
    fireEvent.click(screen.getByText("en:install.cancelInstallation"));
    await waitFor(() => expect(cancelInstall).toHaveBeenCalledOnce());
    expect(props.onCancel).toHaveBeenCalledOnce();

    act(() => {
      progressListener({
        step: 1,
        totalSteps: 7,
        title: "installing",
        detail: "installing",
        log: "installing",
        cancellable: false,
      });
    });
    expect(screen.getByText("en:install.cancelInstallation")).toBeDisabled();
  });
});
