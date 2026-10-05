import { createHash } from "crypto";
import { portableNativeText } from "./native-workspace";
import type { NativeScheduleDraft } from "@mithril/workspace/schedules";
import type { CronJob } from "./cronjobs";
// @lat: [[cloud-workspace#Cloud workspace#Cloud schedules]]
export function projectLocalSchedules(jobs: CronJob[]): NativeScheduleDraft[] {
  return jobs.map((job) => {
    const interval = job.schedule.match(/^(\d+)(m|h|d)$/),
      minutes = interval
        ? Number(interval[1]) *
          (interval[2] === "h" ? 60 : interval[2] === "d" ? 1440 : 1)
        : null;
    const blocked =
      !portableNativeText(job.name) ||
      !portableNativeText(job.prompt) ||
      job.name.length > 200 ||
      job.prompt.length > 16000 ||
      !!job.script;
    return {
      sourceId: createHash("sha256").update(job.id).digest("hex"),
      name: portableNativeText(job.name) ? job.name : "Local schedule",
      prompt: blocked ? "" : job.prompt,
      schedule: portableNativeText(job.schedule)
        ? job.schedule
        : "Review on device",
      intervalMinutes:
        minutes !== null && minutes >= 10 && minutes <= 10080 ? minutes : null,
      enabled: job.enabled,
      ...(blocked
        ? {
            blockedReason:
              "Script or sensitive/device-specific content stays on this device; review in the native screen.",
          }
        : {}),
    };
  });
}
