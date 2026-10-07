import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CloudSchedules from "./CloudSchedules";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
// @lat: [[cloud-workspace-tests#Original Schedules unified screen]]
it("uses the original Desktop cards and lifecycle controls without a device dialog and resets on account changes", async () => {
  const listeners = new Set<() => void>();
  const changed = (): void => {
    for (const cb of listeners) cb();
  };
  let paused = false;
  const pause = vi.fn(async () => {
    paused = true;
    return { success: true };
  });
  const cloudRow = {
    id: "one",
    name: "Cloud task",
    prompt: "cloud prompt",
    model: "retained-model",
    intervalMinutes: 17,
    enabled: true,
    deleted: false,
    revision: 1,
    nextRunAt: 1790000000,
    lastRunAt: null,
    lastSessionId: null,
    lastStatus: null,
  };
  const apply = vi.fn(async (edit) => {
    const configuration = {
      id: edit.id,
      name: edit.name,
      prompt: edit.prompt,
      model: edit.model,
      intervalMinutes: edit.intervalMinutes,
      enabled: edit.enabled,
      deleted: edit.deleted,
    };
    Object.assign(cloudRow, configuration, { revision: 2 });
    return {
      schemaVersion: 1,
      userId: "owner",
      operationId: edit.operationId,
      status: "accepted",
      schedule: cloudRow,
    };
  });
  const api = {
    cloudWorkspace: {
      status: vi.fn(async () => ({ userId: "owner", enabled: true })),
      schedules: {
        list: vi.fn(async () => ({
          schemaVersion: 1,
          userId: "owner",
          schedules: [cloudRow],
        })),
        apply,
      },
    },
    listCronJobs: vi.fn(async () => [
      {
        id: "one",
        name: "Original task",
        schedule: "17 9 * * 1-5",
        prompt: "original prompt",
        state: paused ? "paused" : "active",
        enabled: !paused,
        next_run_at: null,
        last_run_at: null,
        last_status: null,
        last_error: null,
        repeat: null,
        deliver: [],
        skills: [],
        script: null,
      },
    ]),
    pauseCronJob: pause,
    onCloudWorkspaceAccountChanged: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
  vi.stubGlobal("hermesAPI", api);
  const { container } = render(
    <CloudSchedules profile="default" locale="en" />,
  );
  await screen.findByText("Original task");
  await screen.findByText("Cloud task");
  expect(container.querySelectorAll(".schedules-container")).toHaveLength(1);
  expect(screen.getByRole("button", { name: /New Task/ })).toBeTruthy();
  expect(screen.queryByText("Schedules on this device")).toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  fireEvent.click(
    container.querySelector<HTMLButtonElement>('button[data-tooltip="Pause"]')!,
  );
  await screen.findByText("Paused");
  expect(pause).toHaveBeenCalledWith("one", "default");
  const cloudCard = screen.getByText("Cloud task").closest(".schedules-card")!;
  fireEvent.click(
    cloudCard.querySelector<HTMLButtonElement>('button[data-tooltip="Pause"]')!,
  );
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0][0]).toMatchObject({
    id: "one",
    model: "retained-model",
    intervalMinutes: 17,
    enabled: false,
  });
  expect(pause).toHaveBeenCalledTimes(1);
  expect(
    cloudCard.querySelector('button[data-tooltip="Trigger Now"]'),
  ).toBeNull();
  const calls = api.listCronJobs.mock.calls.length;
  act(() => changed());
  await waitFor(() =>
    expect(api.listCronJobs.mock.calls.length).toBeGreaterThan(calls),
  );
});

// @lat: [[cloud-workspace-tests#Unified Schedules late connection isolation]]
it("discards an old account connection that resolves after account replacement", async () => {
  const listeners = new Set<() => void>();
  let release!: (value: { userId: string; enabled: boolean }) => void;
  const first = new Promise<{ userId: string; enabled: boolean }>((resolve) => {
    release = resolve;
  });
  const list = vi.fn(async () => ({
    schemaVersion: 1,
    userId: "new-owner",
    schedules: [],
  }));
  const original = vi.fn(async () => []);
  vi.stubGlobal("hermesAPI", {
    cloudWorkspace: {
      status: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockResolvedValue({ userId: "new-owner", enabled: true }),
      schedules: { list },
    },
    listCronJobs: original,
    onCloudWorkspaceAccountChanged: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  });
  const { container } = render(<CloudSchedules profile="default" />);
  act(() => {
    for (const cb of listeners) cb();
  });
  await screen.findByText("No scheduled tasks yet");
  const calls = original.mock.calls.length;
  await act(async () => {
    release({ userId: "old-owner", enabled: true });
    await first;
  });
  expect(original).toHaveBeenCalledTimes(calls);
  expect(list).toHaveBeenCalledTimes(1);
  expect(container.querySelectorAll(".schedules-container")).toHaveLength(1);
});
