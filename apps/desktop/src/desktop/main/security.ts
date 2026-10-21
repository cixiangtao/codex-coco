/** Exact entry URL and main frame are checked independently by the IPC adapter. */
export function isTrustedPage(actual: string, expected: string) {
  try {
    const first = new URL(actual);
    const second = new URL(expected);
    return (
      first.protocol === second.protocol &&
      first.host === second.host &&
      first.pathname === second.pathname &&
      first.search === second.search
    );
  } catch {
    return false;
  }
}
