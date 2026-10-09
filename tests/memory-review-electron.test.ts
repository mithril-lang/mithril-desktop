/** Opt-in real Electron/preload/hook/panel to ticket WS and persistent Hermes worker. */
import { expect, it } from "vitest";
import { _electron } from "playwright";
import { readFile } from "node:fs/promises";

interface Proposal {
  owner: string;
  cycle: number;
  id: string;
  summary: string;
  content: string;
  target: string;
  decision: string;
  lost?: boolean;
  recorded?: boolean;
}
interface Fixture {
  origin: string;
  issuer: string;
  build: string;
  executable: string;
  retired: Proposal;
  proposals: Proposal[];
}
const fixture = process.env.MITHRIL_MEMORY_ELECTRON_FIXTURE;
// @lat: [[owned-tool-calls#Pending memory human review#Real Electron review and result loss]]
it.skipIf(!fixture)(
  "qualifies real Electron full review, profile retirement and committed result loss",
  async () => {
    const config = JSON.parse(await readFile(fixture!, "utf8")) as Fixture;
    const app = await _electron.launch({
      executablePath: config.executable,
      args: [config.build + "/main.cjs"],
      env: { ...process.env, MITHRIL_MEMORY_ELECTRON_FIXTURE: fixture! },
    });
    try {
      const page = await app.firstWindow();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const attach = page.getByRole("button", {
        name: "Attach selected conversation",
      });
      const inspect = page.getByRole("button", {
        name: "Inspect pending memory",
      });
      const state = async (): Promise<{ delayed: boolean; lost: boolean }> =>
        (
          await fetch(config.origin + "/qualification/state", {
            headers: { "X-Qualification-Issuer": config.issuer },
          })
        ).json();
      await attach.click();
      await inspect.waitFor();
      expect(
        await page
          .locator(".memory-review-panel")
          .evaluate((element) => getComputedStyle(element).display),
      ).toBe("flex");
      await inspect.click();
      await page
        .getByRole("button", {
          name: "Review proposal: " + config.retired.summary,
        })
        .click();
      await expect.poll(async () => (await state()).delayed).toBe(true);
      await page.getByRole("combobox", { name: "Profile" }).selectOption("b");
      await fetch(config.origin + "/qualification/release", {
        method: "POST",
        headers: { "X-Qualification-Issuer": config.issuer },
      });
      expect(
        await page
          .getByRole("button", { name: "Approve this memory change" })
          .count(),
      ).toBe(0);
      expect(
        await page
          .getByRole("button", { name: "I confirmed it was saved" })
          .count(),
      ).toBe(0);
      expect(await page.locator("pre").count()).toBe(0);
      for (const cycle of [0, 1, 2]) {
        const owner = cycle === 1 ? "b" : "a";
        await page
          .getByRole("combobox", { name: "Profile" })
          .selectOption(owner);
        await attach.click();
        await inspect.waitFor();
        for (const row of config.proposals.filter(
          (proposal) => proposal.cycle === cycle,
        )) {
          await inspect.click();
          await page
            .getByRole("button", { name: "Review proposal: " + row.summary })
            .click();
          const full = page.locator("pre");
          await expect
            .poll(() => full.textContent())
            .toContain(row.content.split("\n").at(-1));
          expect(await full.textContent()).toContain(
            row.target === "user" ? "USER.md" : "MEMORY.md",
          );
          expect(await full.locator("script").count()).toBe(0);
          if (row.decision.startsWith("resolve-")) {
            expect(await full.textContent()).toContain(
              "Recorded decision receipt:",
            );
            expect(await full.textContent()).toContain(
              "Current saved entries:",
            );
            expect(
              await page
                .getByRole("button", { name: "Approve this memory change" })
                .count(),
            ).toBe(0);
            if (row.recorded)
              expect(await full.textContent()).toContain(
                "Previously recorded assessment: " +
                  row.decision.replace("resolve-", ""),
              );
          }
          await page
            .getByRole("button", {
              name: row.decision.startsWith("resolve-")
                ? row.decision === "resolve-saved"
                  ? "I confirmed it was saved"
                  : "I confirmed it was not saved"
                : row.decision === "approve"
                  ? "Approve this memory change"
                  : "Reject this memory change",
            })
            .click();
          if (row.lost) {
            await expect.poll(async () => (await state()).lost).toBe(true);
            await expect.poll(() => inspect.count()).toBe(0);
            await attach.click();
            await inspect.waitFor();
          } else {
            await page.locator(".memory-review-panel [role=status]").waitFor();
            expect(await page.locator("body").innerText()).toMatch(
              /Approved 1 memory write|Rejected pending memory write|Closed the recorded memory decision/,
            );
          }
          expect(
            await page
              .getByRole("button", { name: "Approve this memory change" })
              .count(),
          ).toBe(0);
        }
      }
      // The retired outcome response did not close; require a new full review and explicit assessment.
      await inspect.click();
      await page
        .getByRole("button", {
          name: "Review proposal: " + config.retired.summary,
        })
        .click();
      await page
        .getByRole("button", { name: "I confirmed it was not saved" })
        .click();
      await page.locator(".memory-review-panel [role=status]").waitFor();
      await inspect.click();
      await page.getByText("No pending memory changes.").waitFor();
      expect(errors).toEqual([]);
      console.log(
        "real isolated Electron memory review qualified: 6 normal decisions, 7 outcome closures, retired review, committed reply loss",
      );
    } finally {
      await app.close();
    }
  },
  90000,
);
