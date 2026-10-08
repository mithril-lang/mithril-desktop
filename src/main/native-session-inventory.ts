/** Read bounded pages inside the caller's original SQLite read transaction. */
export function nativeSessionInventory<T extends { id: string }>(
  read: (limit: number, offset: number) => T[],
): T[] {
  const records: T[] = [];
  const seen = new Set<string>();
  for (;;) {
    const page = read(100, records.length);
    if (!Array.isArray(page) || page.length > 100)
      throw Error("Invalid native history inventory page; source retained");
    for (const record of page) {
      if (
        !record ||
        typeof record.id !== "string" ||
        !record.id ||
        seen.has(record.id)
      )
        throw Error("Native history inventory changed; source retained");
      seen.add(record.id);
      records.push(record);
    }
    if (page.length < 100) return records;
  }
}
