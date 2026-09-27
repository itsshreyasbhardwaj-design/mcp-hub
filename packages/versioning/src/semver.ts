/**
 * Version ordering.
 *
 * Registry versions are arbitrary strings, so comparison falls back to a
 * natural-order comparison when a version is not semver. Sorting must never
 * throw, because a single odd version string would otherwise break a list.
 */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  raw: string;
  isSemver: boolean;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(raw: string): ParsedVersion {
  const match = SEMVER_RE.exec(raw.trim());
  if (!match) {
    return { major: 0, minor: 0, patch: 0, prerelease: null, raw, isSemver: false };
  }
  return {
    major: Number.parseInt(match[1] ?? '0', 10),
    minor: Number.parseInt(match[2] ?? '0', 10),
    patch: Number.parseInt(match[3] ?? '0', 10),
    prerelease: match[4] ?? null,
    raw,
    isSemver: true,
  };
}

/** Returns a negative number when `a` sorts before `b`. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);

  if (left.isSemver && right.isSemver) {
    if (left.major !== right.major) return left.major - right.major;
    if (left.minor !== right.minor) return left.minor - right.minor;
    if (left.patch !== right.patch) return left.patch - right.patch;
    if (left.prerelease === right.prerelease) return 0;
    // A prerelease sorts before its release.
    if (left.prerelease === null) return 1;
    if (right.prerelease === null) return -1;
    return left.prerelease.localeCompare(right.prerelease);
  }
  if (left.isSemver !== right.isSemver) return left.isSemver ? 1 : -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortVersionsDescending<T>(items: readonly T[], pick: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareVersions(pick(b), pick(a)));
}

/**
 * The version bump the observed changes would justify. Advisory only: MCP Hub
 * never rewrites a publisher's version number.
 */
export function suggestedBump(
  breakingChanges: number,
  additions: number,
): 'major' | 'minor' | 'patch' {
  if (breakingChanges > 0) return 'major';
  if (additions > 0) return 'minor';
  return 'patch';
}
