import { expect, it } from "vitest";
import { projectLocalSchedules } from "./local-schedule-preview";
import type { CronJob } from "./cronjobs";
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud schedule boundaries]]
it("projects only reviewed task text and intervals, excluding scripts, credentials, paths and external delivery", () => {
  const job: CronJob = {
    id: "local",
    name: "Test",
    prompt: "Synthetic task",
    schedule: "2h",
    state: "active",
    enabled: true,
    next_run_at: null,
    last_run_at: null,
    last_status: null,
    last_error: null,
    repeat: null,
    deliver: ["email"],
    skills: ["native-tool"],
    script: null,
  };
  const good = projectLocalSchedules([job])[0]!;
  expect(good.intervalMinutes).toBe(120);
  expect(good.sourceId).not.toBe(job.id);
  expect(good).not.toHaveProperty("deliver");
  expect(good).not.toHaveProperty("skills");
  const blocked = projectLocalSchedules([
    { ...job, prompt: "Bearer a-secret" },
    { ...job, prompt: "Read /Users/jun/private.txt" },
    { ...job, script: "native.py" },
  ]);
  expect(blocked.every((d) => d.prompt === "" && !!d.blockedReason)).toBe(true);
  expect(
    projectLocalSchedules([{ ...job, schedule: "0 9 * * *" }])[0]
      ?.intervalMinutes,
  ).toBeNull();
});
