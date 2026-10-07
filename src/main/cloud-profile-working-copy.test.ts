// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCloudProfileWorkingCopy } from "./cloud-profile-working-copy";
const roots: string[] = [];
afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function fixture(): {
  scope: { home: string; directory: string; owner: string; profile: string };
  authority: {
    guard: ReturnType<typeof vi.fn<() => void>>;
    hasBinding: ReturnType<typeof vi.fn<() => boolean>>;
    bind: ReturnType<typeof vi.fn<() => void>>;
  };
} {
  const home = realpathSync(
    mkdtempSync(join(tmpdir(), "mithril-cloud-profile-")),
  );
  roots.push(home);
  let bound = false;
  return {
    scope: {
      home,
      directory: join(home, "intents"),
      owner: "alice",
      profile: "research",
    },
    authority: {
      guard: vi.fn(),
      hasBinding: vi.fn(() => bound),
      bind: vi.fn(() => {
        bound = true;
      }),
    },
  };
}
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud profile first materialization]]
it("creates only an empty original profile and retains completed ownership without copying keys", () => {
  const f = fixture();
  const root = createCloudProfileWorkingCopy(f.scope, f.authority)!;
  expect(root).toBe(join(f.scope.home, "profiles", "research"));
  expect(readdirSync(root)).toEqual([]);
  expect(f.authority.bind).toHaveBeenCalledOnce();
  const intent = JSON.parse(
    readFileSync(
      join(f.scope.directory, readdirSync(f.scope.directory)[0]),
      "utf8",
    ),
  );
  expect(intent.phase).toBe("ready");
  expect(createCloudProfileWorkingCopy(f.scope, f.authority)).toBeNull();
  rmSync(root, { recursive: true });
  expect(createCloudProfileWorkingCopy(f.scope, f.authority)).toBeNull();
  expect(existsSync(root)).toBe(false);
});
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud profile retained deletion]]
it("does not recreate an original missing source with a retained binding", () => {
  const f = fixture();
  f.authority.hasBinding.mockReturnValue(true);
  expect(createCloudProfileWorkingCopy(f.scope, f.authority)).toBeNull();
  expect(existsSync(f.scope.directory)).toBe(false);
});
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud profile interrupted creation]]
it("recovers a durable pre-directory intent after a failed creation boundary", () => {
  const f = fixture();
  f.authority.bind.mockImplementationOnce(() => {
    throw Error("interrupted");
  });
  expect(() => createCloudProfileWorkingCopy(f.scope, f.authority)).toThrow(
    "interrupted",
  );
  expect(existsSync(join(f.scope.home, "profiles", "research"))).toBe(false);
  const root = createCloudProfileWorkingCopy(f.scope, f.authority)!;
  expect(root).toBeTruthy();
  const path = join(f.scope.directory, readdirSync(f.scope.directory)[0]);
  const intent = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...intent, phase: "creating" }));
  expect(createCloudProfileWorkingCopy(f.scope, f.authority)).toBeNull();
  expect(JSON.parse(readFileSync(path, "utf8")).phase).toBe("ready");
  rmSync(root, { recursive: true });
  expect(createCloudProfileWorkingCopy(f.scope, f.authority)).toBeNull();
});
// @lat: [[cloud-workspace-tests#Cloud workspace tests#Cloud profile creation authority]]
it("refuses foreign ownership, account invalidation and unsafe ancestors before profile creation", () => {
  const f = fixture();
  f.authority.hasBinding.mockImplementationOnce(() => {
    throw Error("foreign owner");
  });
  expect(() => createCloudProfileWorkingCopy(f.scope, f.authority)).toThrow(
    "foreign owner",
  );
  f.authority.guard.mockImplementationOnce(() => {
    throw Error("identity changed");
  });
  expect(() => createCloudProfileWorkingCopy(f.scope, f.authority)).toThrow(
    "identity changed",
  );
  mkdirSync(join(f.scope.home, "elsewhere"));
  symlinkSync(
    join(f.scope.home, "elsewhere"),
    join(f.scope.home, "profiles"),
    "dir",
  );
  expect(() => createCloudProfileWorkingCopy(f.scope, f.authority)).toThrow(
    "Unsafe",
  );
  expect(existsSync(f.scope.directory)).toBe(false);
});
