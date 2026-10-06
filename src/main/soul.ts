import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { profileHome } from "./utils";

import { writePersona } from "./memory";

const DEFAULT_SOUL = `You are Mithril, a helpful AI assistant. You are friendly, knowledgeable, and always eager to help.

You communicate clearly and concisely. When asked to perform tasks, you think step-by-step and explain your reasoning. You are honest about your limitations and ask for clarification when needed.

You strive to be helpful while being safe and responsible. You respect the user's privacy and handle sensitive information carefully.
`;

export function readSoul(profile?: string): string {
  const soulFile = join(profileHome(profile), "SOUL.md");
  if (!existsSync(soulFile)) return "";

  try {
    return readFileSync(soulFile, "utf-8");
  } catch {
    return "";
  }
}

export function writeSoul(
  content: string,
  profile?: string,
  expected?: string,
): boolean {
  return writePersona(content, profile, expected).success;
}

export function resetSoul(profile?: string, expected?: string): string {
  const result = writePersona(DEFAULT_SOUL, profile, expected);
  if (!result.success) throw new Error(result.error ?? "Persona unavailable");
  return DEFAULT_SOUL;
}
