export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const index = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(1)} ${["B", "KiB", "MiB", "GiB", "TiB"][index]}`;
}
