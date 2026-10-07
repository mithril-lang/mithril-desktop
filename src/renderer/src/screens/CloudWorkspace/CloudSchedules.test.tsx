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
  let changed = (): void => {};
  let paused = false;
  const pause = vi.fn(async () => {
    paused = true;
    return { success: true };
  });
  const api = {
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
      changed = cb;
      return () => {};
    },
  };
  vi.stubGlobal("hermesAPI", api);
  const { container } = render(
    <CloudSchedules profile="default" locale="en" />,
  );
  await screen.findByText("Original task");
  expect(screen.getByRole("button", { name: /New Task/ })).toBeTruthy();
  expect(screen.queryByText("Schedules on this device")).toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  fireEvent.click(
    container.querySelector<HTMLButtonElement>('button[data-tooltip="Pause"]')!,
  );
  await screen.findByText("Paused");
  expect(pause).toHaveBeenCalledWith("one", "default");
  const calls = api.listCronJobs.mock.calls.length;
  act(() => changed());
  await waitFor(() =>
    expect(api.listCronJobs.mock.calls.length).toBeGreaterThan(calls),
  );
});
