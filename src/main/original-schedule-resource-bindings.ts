import type { OriginalScheduleBindingPatch } from "@mithril/workspace/original-schedule-text";
import type { OriginalScheduleNativeWrite } from "@mithril/workspace/original-schedule-file-replica";
import type { OriginalCronFile } from "./cron-source-files";
import type { OriginalScheduleResourceBindings } from "./original-schedule-native-port";
import {
  NativeOriginalScheduleReplicaStore,
  type OriginalSchedulePrivateDirectoryTarget,
} from "./original-schedule-replica-store";
import { OriginalScheduleScriptResources } from "./original-schedule-script-resources";
import { OriginalScheduleWorkdirResources } from "./original-schedule-workdir-resources";

/** Resource stages compose with mandatory runtime/authority binding; neither can be bypassed. */
// @lat: [[cloud-workspace#Original schedule resource composition (draft)]]
export class OriginalScheduleFileResourceBindings implements OriginalScheduleResourceBindings {
  constructor(
    private readonly scripts: OriginalScheduleScriptResources,
    private readonly workdirs: OriginalScheduleWorkdirResources,
    private readonly store: NativeOriginalScheduleReplicaStore,
    private readonly runtime: OriginalScheduleResourceBindings,
    private readonly scriptBaseline: () => Promise<string>,
    private readonly workdirTarget: (
      jobId: string,
      manifest: string,
      identity?: string,
    ) => Promise<OriginalSchedulePrivateDirectoryTarget>,
    private readonly assertActive: () => Promise<void>,
  ) {}
  async capture(
    source: OriginalCronFile,
  ): Promise<readonly OriginalScheduleBindingPatch[]> {
    await this.assertActive();
    const runtime = await this.runtime.capture(source);
    await this.assertActive();
    const scripts = await this.scripts.capture(source);
    const workdirs = await this.workdirs.capture(source);
    await this.assertActive();
    return [...runtime, ...scripts, ...workdirs];
  }
  async restore(
    write: OriginalScheduleNativeWrite,
  ): Promise<readonly OriginalScheduleBindingPatch[]> {
    await this.assertActive();
    const runtime = await this.runtime.restore(write);
    await this.assertActive();
    const manifest = this.scripts.manifestForRestore(write);
    let scripts: readonly OriginalScheduleBindingPatch[] = [];
    if (manifest) {
      const target = await this.store.retainDirectoryTarget(
        write,
        { kind: "scripts", jobId: null },
        manifest,
        async () => ({
          root: this.scripts.root,
          expectedManifest: await this.scriptBaseline(),
        }),
      );
      await this.assertActive();
      if (target.root !== this.scripts.root)
        throw Error("Original script private destination changed");
      scripts = await this.scripts.restore(write, target.expectedManifest);
    }
    const workdirs = await this.workdirs.restore(
      write,
      (jobId, resourceManifest, identity) =>
        this.store.retainDirectoryTarget(
          write,
          { kind: "workdir", jobId },
          resourceManifest,
          () => this.workdirTarget(jobId, resourceManifest, identity),
        ),
    );
    await this.assertActive();
    return [...runtime, ...scripts, ...workdirs];
  }
}
