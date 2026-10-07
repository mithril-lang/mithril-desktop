import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
  }),
}));

vi.mock("../modal/AppModal", () => ({
  AppModal: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }): React.JSX.Element | null => (open ? <div>{children}</div> : null),
  AppModalTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}));

vi.mock("../common/ProfileAvatar", () => ({
  default: ({ name }: { name: string }): React.JSX.Element => (
    <span data-testid={`avatar-${name}`} />
  ),
}));

vi.mock("../../screens/Soul/Soul", () => ({
  default: (): React.JSX.Element => <div data-testid="soul" />,
}));

vi.mock("./ProfileWalletPane", () => ({
  default: (): React.JSX.Element => <div data-testid="wallet" />,
}));

import ProfileModal from "./ProfileModal";

interface ProfileInfo {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

function profile(name = "Default Agent"): ProfileInfo {
  return {
    id: "default",
    name,
    path: "/tmp/hermes",
    isDefault: true,
    isActive: true,
    model: "",
    provider: "auto",
    hasEnv: false,
    hasSoul: false,
    skillCount: 0,
    gatewayRunning: false,
  };
}

function installHermesAPI(profiles: ProfileInfo[]): {
  setProfileName: ReturnType<typeof vi.fn>;
} {
  const setProfileName = vi.fn().mockResolvedValue({ success: true });
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      listProfiles: vi.fn().mockResolvedValue(profiles),
      setProfileName,
      setProfileColor: vi.fn().mockResolvedValue({ success: true }),
      setProfileAvatar: vi.fn().mockResolvedValue({ success: true }),
      removeProfileAvatar: vi.fn().mockResolvedValue({ success: true }),
      deleteProfile: vi.fn().mockResolvedValue({ success: true }),
      readMemory: vi.fn().mockResolvedValue({ entries: [] }),
    },
  });
  return { setProfileName };
}

function renderModal(): void {
  render(
    <ProfileModal
      name="default"
      open
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
}

async function startNameEdit(): Promise<HTMLInputElement> {
  fireEvent.click(
    await screen.findByRole("button", { name: "agents.nameLabel" }),
  );
  return screen.getByRole("textbox", {
    name: "agents.nameLabel",
  }) as HTMLInputElement;
}

describe("ProfileModal name editor", () => {
  it("does not save a canceled Escape edit when blur fires afterward", async () => {
    const api = installHermesAPI([profile()]);
    renderModal();

    const input = await startNameEdit();
    fireEvent.change(input, { target: { value: "Edited Agent" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(api.setProfileName).not.toHaveBeenCalled();
    });
    expect(screen.getAllByText("Default Agent").length).toBeGreaterThan(0);
  });

  it("still saves on blur after a canceled edit is reopened", async () => {
    const api = installHermesAPI([profile()]);
    renderModal();

    const canceledInput = await startNameEdit();
    fireEvent.change(canceledInput, { target: { value: "Canceled Agent" } });
    fireEvent.keyDown(canceledInput, { key: "Escape" });

    const savedInput = await startNameEdit();
    fireEvent.change(savedInput, { target: { value: "Saved Agent" } });
    fireEvent.blur(savedInput);

    await waitFor(() => {
      expect(api.setProfileName).toHaveBeenCalledWith("default", "Saved Agent");
    });
  });
});

describe("ProfileModal deletion failures", () => {
  // @lat: [[mithril-migration#Mithril desktop migration#First-run connect]]
  it("disables deletion while pending and allows retry after an IPC rejection", async () => {
    installHermesAPI([
      { ...profile("Agent Alpha"), id: "alpha", isDefault: false },
    ]);
    let reject!: (reason: Error) => void;
    const request = new Promise<never>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    const deleteProfile = vi
      .fn()
      .mockReturnValueOnce(request)
      .mockResolvedValue({ success: false, error: "profile is busy" });
    window.hermesAPI.deleteProfile = deleteProfile;
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(
      <ProfileModal
        name="alpha"
        open
        initialSection="advanced"
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "agents.deleteProfile" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "agents.deleteProfile" }),
    );
    expect(
      screen.getByRole("button", { name: "agents.deleteProfile" }),
    ).toBeDisabled();
    reject(new Error("IPC failed"));
    expect(await screen.findByText("agents.deleteFailed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "agents.deleteProfile" }),
    ).not.toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "agents.deleteProfile" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "agents.deleteProfile" }),
    );
    expect(await screen.findByText("profile is busy")).toBeInTheDocument();
    expect(deleteProfile).toHaveBeenCalledTimes(2);
    expect(deleteProfile).toHaveBeenLastCalledWith("alpha");
  });
});

// @lat: [[cloud-workspace-tests#Shared original profile Memory native adapter]]
it("uses the shared original Agent Memory pane with the exact Native source baseline", async () => {
  installHermesAPI([profile()]);
  vi.mocked(window.hermesAPI.readMemory).mockResolvedValue({
    memory: {
      content: "Original entry",
      entries: [{ index: 0, content: "Original entry" }],
      exists: true,
      lastModified: null,
      charCount: 14,
      charLimit: 2200,
    },
    user: {
      content: "Original user",
      exists: true,
      lastModified: null,
      charCount: 13,
      charLimit: 1375,
    },
    stats: { totalSessions: 0, totalMessages: 0 },
  });
  const save = vi.fn().mockResolvedValue({ success: true });
  Object.assign(window.hermesAPI, { updateMemoryEntry: save });
  renderModal();
  fireEvent.click(
    await screen.findByRole("button", { name: "agents.sectionAgentMemory" }),
  );
  await screen.findByText("Original entry");
  fireEvent.click(screen.getByRole("button", { name: "memory.edit" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Edited entry" },
  });
  fireEvent.click(screen.getByRole("button", { name: "memory.save" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(0, "Edited entry", "default", {
      memory: "Original entry",
      user: "Original user",
    }),
  );
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Profile dialog read recovery]]
it("recovers a failed profile read inside the original dialog without another sign-in", async () => {
  installHermesAPI([profile()]);
  const list = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([profile()]);
  window.hermesAPI.listProfiles = list;
  renderModal();
  await screen.findByText("agents.profileLoadFailed");
  fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
  await screen.findByRole("button", { name: "agents.nameLabel" });
  expect(screen.queryByText("agents.profileLoadFailed")).toBeNull();
  expect(list).toHaveBeenCalledTimes(2);
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Profile dialog missing source]]
it("shows an unavailable profile instead of keeping the loading animation indefinitely", async () => {
  installHermesAPI([]);
  renderModal();
  await screen.findByText("agents.profileUnavailable");
  expect(screen.getByRole("button", { name: "common.retry" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "common.done" })).toBeEnabled();
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Profile dialog scope fencing]]
it("ignores late profile reads after the dialog changes to another agent", async () => {
  installHermesAPI([]);
  let resolve!: (value: ProfileInfo[]) => void;
  const first = new Promise<ProfileInfo[]>((done) => {
    resolve = done;
  });
  const beta = { ...profile("Beta"), id: "beta" };
  window.hermesAPI.listProfiles = vi
    .fn()
    .mockReturnValueOnce(first)
    .mockResolvedValue([beta]);
  const view = render(<ProfileModal name="alpha" open onClose={() => {}} />);
  await waitFor(() =>
    expect(window.hermesAPI.listProfiles).toHaveBeenCalledTimes(1),
  );
  view.rerender(<ProfileModal name="beta" open onClose={() => {}} />);
  await screen.findByRole("dialog", { name: "Beta" });
  await act(async () => {
    resolve([{ ...profile("Alpha"), id: "alpha" }]);
  });
  expect(screen.queryByText("Alpha")).toBeNull();
  expect(screen.getByRole("dialog", { name: "Beta" })).toBeInTheDocument();
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Profile dialog bounded read]]
it("bounds a stuck initial read and ignores its response after a successful retry", async () => {
  installHermesAPI([]);
  let resolve!: (value: ProfileInfo[]) => void;
  const first = new Promise<ProfileInfo[]>((done) => {
    resolve = done;
  });
  window.hermesAPI.listProfiles = vi
    .fn()
    .mockReturnValueOnce(first)
    .mockResolvedValue([profile("Recovered")]);
  vi.useFakeTimers();
  const view = render(<ProfileModal name="default" open onClose={() => {}} />);
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12001);
    });
    expect(screen.getByText("agents.profileLoadFailed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(
      screen.getByRole("dialog", { name: "Recovered" }),
    ).toBeInTheDocument();
    await act(async () => {
      resolve([profile("Late")]);
    });
    expect(screen.queryByText("Late")).toBeNull();
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

// @lat: [[cloud-workspace-tests#Cloud workspace tests#Profile dialog late deletion]]
it("does not close another agent dialog when an older deletion finishes", async () => {
  installHermesAPI([{ ...profile("Alpha"), id: "alpha", isDefault: false }]);
  let resolve!: (value: { success: boolean }) => void;
  window.hermesAPI.deleteProfile = vi.fn().mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const onClose = vi.fn(),
    onDeleted = vi.fn();
  const view = render(
    <ProfileModal
      name="alpha"
      open
      initialSection="advanced"
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "agents.deleteProfile" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "agents.deleteProfile" }));
  window.hermesAPI.listProfiles = vi
    .fn()
    .mockResolvedValue([{ ...profile("Beta"), id: "beta" }]);
  view.rerender(
    <ProfileModal
      name="beta"
      open
      initialSection="profile"
      onClose={onClose}
      onDeleted={onDeleted}
    />,
  );
  await screen.findByRole("dialog", { name: "Beta" });
  await act(async () => {
    resolve({ success: true });
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(onDeleted).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Beta" })).toBeInTheDocument();
});
