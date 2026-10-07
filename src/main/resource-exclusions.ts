/** Consumer-owned relative data exclusions; never derived from a remote manifest. */
export function resourceExclusions(
  paths: readonly string[],
): readonly string[] {
  if (
    !Array.isArray(paths) ||
    paths.length > 100 ||
    !paths.every(
      (path) =>
        typeof path === "string" &&
        path.length > 0 &&
        path.length <= 1024 &&
        !path.includes("\\") &&
        !path.includes("\0") &&
        path
          .split("/")
          .every((part) => part !== "" && part !== "." && part !== ".."),
    )
  )
    throw Error("Invalid private resource exclusions");
  return Object.freeze([...new Set(paths)].sort());
}
export function resourceExcluded(
  path: string,
  exclusions: readonly string[],
): boolean {
  return exclusions.some(
    (entry) => path === entry || path.startsWith(entry + "/"),
  );
}
