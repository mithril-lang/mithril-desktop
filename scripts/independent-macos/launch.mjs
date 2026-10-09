/* eslint-disable @typescript-eslint/explicit-function-return-type -- Independent native qualification. */
import { join } from "node:path";

export function launchEnvironment(env, directory) {
  if (!env.HOME) throw Error("Native launch requires the existing OS home");
  return {
    PATH: env.PATH,
    HOME: env.HOME,
    TMPDIR: directory,
    HERMES_HOME: join(directory, "profile"),
    HERMES_DESKTOP_USER_DATA_DIR: join(directory, "userdata"),
    LANG: "en_US.UTF-8",
  };
}

async function bounded(work, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error(`${label} timed out`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyLaunch(application, screenshot, timeout = 60000) {
  let failure;
  try {
    const window = await application.firstWindow({ timeout });
    await window
      .getByRole("heading", { name: "Welcome to Mithril" })
      .waitFor({ timeout });
    await window.screenshot({ path: screenshot, timeout });
  } catch (error) {
    failure = error;
  } finally {
    try {
      await bounded(
        application.close(),
        Math.min(timeout, 10000),
        "Native app shutdown",
      );
    } catch (error) {
      // This is the exact child returned by this isolated launch, never an
      // installed app or a process-name match. Failure cannot issue a receipt.
      const child = application.process();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGKILL");
        await bounded(
          exited,
          Math.min(timeout, 10000),
          "Native child termination",
        );
      }
      failure ??= error;
    }
  }
  if (failure) throw failure;
}
