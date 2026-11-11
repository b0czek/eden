import type { Dirent } from "node:fs";
import * as path from "node:path";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { io } from "./native-io";

export interface SearchMatch {
  /** Slash-separated path relative to the searched directory. */
  relativePath: string;
  name: string;
  isDirectory: boolean;
  score: number;
}

const exactScore = 1000;
const depthPenalty = 30;
/** Bounds the walk on large trees; shallower entries are always visited first. */
const entryBudget = 100_000;
const skippedDirectories = new Set(["node_modules"]);
/** Rejects scattered matches whose characters rarely follow each other or start words. */
const minimumSubsequenceQuality = 0.3;

function isWordBoundary(name: string, lowerName: string, index: number) {
  if (index === 0) return true;
  if (!/[\p{L}\p{N}]/u.test(lowerName.charAt(index - 1))) return true;
  // Case changes only map onto the original name when lowercasing kept its length.
  if (name.length !== lowerName.length) return false;
  const previous = name.charAt(index - 1);
  const current = name.charAt(index);
  return (
    previous === previous.toLowerCase() &&
    current !== current.toLowerCase() &&
    current === current.toUpperCase()
  );
}

/** Greedily matches `query` in order from `first`, within a window sized by the query. */
function subsequencePoints(
  name: string,
  lowerName: string,
  query: string,
  first: number,
) {
  let points = 0;
  let previous = first - 1;
  for (const char of query) {
    const index = lowerName.indexOf(char, previous + 1);
    if (index < 0) return undefined;
    if (index - first >= query.length * 3 + 2) return undefined;
    points += 1;
    if (index === previous + 1) points += 3;
    if (isWordBoundary(name, lowerName, index)) points += 4;
    previous = index + char.length - 1;
  }
  return points;
}

function subsequenceScore(name: string, lowerName: string, query: string) {
  const [lead = ""] = query;
  let best: number | undefined;
  // A stray early occurrence of the first character must not hide a tighter match later.
  for (
    let first = lowerName.indexOf(lead);
    first >= 0;
    first = lowerName.indexOf(lead, first + 1)
  ) {
    const points = subsequencePoints(name, lowerName, query, first);
    if (points !== undefined && (best === undefined || points > best))
      best = points;
  }
  if (best === undefined) return undefined;
  const quality = best / (8 * query.length);
  if (quality < minimumSubsequenceQuality) return undefined;
  return (
    Math.round(300 + 300 * quality) -
    Math.min(lowerName.length - query.length, 50)
  );
}

/**
 * Ranks how well a file name matches a case-insensitive query.
 * Returns undefined when the query characters do not appear in order.
 */
export function scoreName(name: string, query: string): number | undefined {
  const lowerQuery = query.toLowerCase();
  if (!lowerQuery) return 0;
  const lowerName = name.toLowerCase();
  if (lowerName === lowerQuery) return exactScore;
  const extension = path.extname(lowerName);
  if (extension && lowerName.slice(0, -extension.length) === lowerQuery) {
    return exactScore - 50;
  }
  if (lowerName.startsWith(lowerQuery)) {
    return 900 - Math.min(lowerName.length - lowerQuery.length, 50);
  }
  const index = lowerName.indexOf(lowerQuery);
  if (index > 0) {
    return (
      (isWordBoundary(name, lowerName, index) ? 800 : 700) - Math.min(index, 50)
    );
  }
  return subsequenceScore(name, lowerName, lowerQuery);
}

function compareMatches(a: SearchMatch, b: SearchMatch) {
  return (
    b.score - a.score ||
    Number(b.isDirectory) - Number(a.isDirectory) ||
    a.name.localeCompare(b.name, undefined, { numeric: true }) ||
    a.relativePath.localeCompare(b.relativePath)
  );
}

export interface SearchWalk {
  /**
   * Reads at least one folder, then continues until `millis` elapse.
   * Succeeds with true when the walk is complete.
   */
  step: (root: string, millis: number) => Effect.Effect<boolean>;
  /**
   * The best matches so far, ranked, the number of entries examined, and a
   * version that changes whenever the matches do.
   */
  snapshot: () => {
    matches: SearchMatch[];
    searched: number;
    version: number;
  };
}

/**
 * Walks a directory breadth-first for the best fuzzy matches by name.
 * An empty query lists the directory's own entries. Hidden entries, symbolic
 * links' targets, and unreadable folders are skipped.
 */
export function createSearchWalk(query: string, limit: number): SearchWalk {
  const trimmed = query.trim();
  const matches: SearchMatch[] = [];
  let frontier = [""];
  let next: string[] = [];
  let position = 0;
  let depth = 0;
  let visited = 0;
  let complete = limit <= 0;
  let version = 0;

  /** Keeps `matches` ranked and no longer than `limit`. */
  const insert = (match: SearchMatch) => {
    let low = 0;
    let high = matches.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const current = matches[middle] as SearchMatch;
      if (compareMatches(current, match) <= 0) low = middle + 1;
      else high = middle;
    }
    if (low >= limit) return;
    matches.splice(low, 0, match);
    if (matches.length > limit) matches.pop();
    version += 1;
  };

  const advance = () => {
    frontier = next;
    next = [];
    position = 0;
    depth += 1;
    const worstKept = matches[limit - 1];
    complete =
      frontier.length === 0 ||
      (worstKept !== undefined &&
        worstKept.score >= exactScore - depth * depthPenalty);
  };

  const read = Effect.fn(function* (root: string, directory: string) {
    const entries = yield* io
      .readdir(path.join(root, directory), { withFileTypes: true })
      .pipe(Effect.orElseSucceed((): Dirent[] => []));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      visited += 1;
      const relativePath = directory
        ? `${directory}/${entry.name}`
        : entry.name;
      const isDirectory = entry.isDirectory();
      if (isDirectory && trimmed && !skippedDirectories.has(entry.name)) {
        next.push(relativePath);
      }
      const score = scoreName(entry.name, trimmed);
      if (score === undefined) continue;
      insert({
        relativePath,
        name: entry.name,
        isDirectory,
        score: score - depth * depthPenalty,
      });
    }
  });

  const step = Effect.fn(function* (root: string, millis: number) {
    const deadline = (yield* Clock.currentTimeMillis) + millis;
    while (!complete) {
      yield* read(root, frontier[position++] ?? "");
      if (visited >= entryBudget) complete = true;
      else if (position >= frontier.length) advance();
      if ((yield* Clock.currentTimeMillis) >= deadline) break;
    }
    return complete;
  });

  return {
    step,
    snapshot: () => ({ matches: [...matches], searched: visited, version }),
  };
}
