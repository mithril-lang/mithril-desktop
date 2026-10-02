const listeners = new Set<() => void>();

export function invalidateCloudWorkspace(): void {
  listeners.forEach((listener) => listener());
}

export function onCloudWorkspaceInvalidated(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
