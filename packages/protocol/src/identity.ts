export function sourceKey(adapterId: string, sourceId: string): string {
  return `${adapterId}::${sourceId}`;
}

export function parseSourceKey(key: string): { adapterId: string; sourceId: string } {
  const separator = key.indexOf("::");
  if (separator <= 0) {
    throw new Error(`invalid source key: ${key}`);
  }
  return { adapterId: key.slice(0, separator), sourceId: key.slice(separator + 2) };
}
