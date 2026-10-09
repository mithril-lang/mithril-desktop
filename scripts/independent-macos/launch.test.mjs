import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { launchEnvironment, verifyLaunch } from "./launch.mjs";

test("retains OS keychain home while isolating both application data roots and secrets", () => {
  const env = launchEnvironment(
    {
      HOME: "/os/home",
      PATH: "/bin",
      APPLE_API_KEY: "secret",
      MITHRIL_API_KEY: "secret",
    },
    "/qa/run",
  );
  assert.equal(env.HOME, "/os/home");
  assert.equal(env.HERMES_HOME, "/qa/run/profile");
  assert.equal(env.HERMES_DESKTOP_USER_DATA_DIR, "/qa/run/userdata");
  assert.equal(env.APPLE_API_KEY, undefined);
  assert.equal(env.MITHRIL_API_KEY, undefined);
  assert.throws(() => launchEnvironment({}, "/qa/run"));
});

test("failed first window and blocked shutdown terminate only the owned child and remain failed", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  let killed = null;
  child.kill = (signal) => {
    killed = signal;
    child.signalCode = signal;
    child.emit("exit");
  };
  await assert.rejects(
    verifyLaunch(
      {
        firstWindow: async (options) => {
          assert.equal(options.timeout, 20);
          throw Error("No first window");
        },
        close: () => new Promise(() => {}),
        process: () => child,
      },
      "/qa/screenshot.png",
      20,
    ),
    /No first window/,
  );
  assert.equal(killed, "SIGKILL");
});

test("only a visible packaged login heading and screenshot followed by shutdown succeed", async () => {
  let screenshot = false,
    closed = false;
  await verifyLaunch(
    {
      firstWindow: async (options) => {
        assert.equal(options.timeout, 30);
        return {
          getByRole: (role, options) => {
            assert.equal(role, "heading");
            assert.equal(options.name, "Welcome to Mithril");
            return {
              waitFor: async (options) => assert.equal(options.timeout, 30),
            };
          },
          screenshot: async (options) => {
            assert.equal(options.path, "/qa/screenshot.png");
            screenshot = true;
          },
        };
      },
      close: async () => {
        closed = true;
      },
    },
    "/qa/screenshot.png",
    30,
  );
  assert.ok(screenshot && closed);
});
