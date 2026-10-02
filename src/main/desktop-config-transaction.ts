import {
  constants,
  existsSync,
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
} from "fs";
import { dirname } from "path";
import { createHash } from "crypto";
const digest = (raw: string): string =>
  createHash("sha256").update(raw).digest("hex");
/** Independent Desktop instances share a short-lived exclusive lock and compare the original document. */
export class DesktopConfigTransaction {
  private originals = new WeakMap<object, { path: string; hash: string }>();
  constructor(
    private readonly path: () => string,
    private readonly atomicWrite: (path: string, content: string) => void,
  ) {}
  private raw(path: string): string {
    if (!existsSync(path)) return "";
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      return readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
  }
  read(strict = false): Record<string, unknown> {
    const path = this.path();
    try {
      const raw = this.raw(path);
      const value: unknown = raw ? JSON.parse(raw.replace(/^\uFEFF/, "")) : {};
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid desktop config");
      this.originals.set(value, { path, hash: digest(raw) });
      return value as Record<string, unknown>;
    } catch {
      if (strict)
        throw new Error(
          "Hermes Desktop could not read desktop.json; the existing file was left unchanged.",
        );
      return {};
    }
  }
  write(value: Record<string, unknown>): void {
    const original = this.originals.get(value);
    const path = this.path();
    if (!original || original.path !== path)
      throw new Error(
        "Desktop settings changed or could not be read; refresh before saving.",
      );
    const lock = `${path}.desktop-lock`;
    mkdirSync(dirname(path), { recursive: true });
    let fd: number;
    try {
      fd = openSync(lock, "wx", 0o600);
    } catch {
      throw new Error(
        "Desktop settings are busy. After a writer crash, close all Desktop instances and clear the stale desktop.json.desktop-lock before saving again.",
      );
    }
    try {
      if (digest(this.raw(path)) !== original.hash)
        throw new Error(
          "Desktop settings changed in another instance; refresh before saving.",
        );
      const content = JSON.stringify(value, null, 2);
      this.atomicWrite(path, content);
      this.originals.set(value, { path, hash: digest(content) });
    } finally {
      closeSync(fd);
      unlinkSync(lock);
    }
  }
}
