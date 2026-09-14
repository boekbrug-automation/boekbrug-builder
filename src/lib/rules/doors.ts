// src/lib/rules/doors.ts
// [REGEL-DEUR] Running a DoorQuery over the repository. Pure apart from reading source files.
//
// This is the half of the register that makes it a query rather than a list. It is separate from
// register.ts for one reason: register.ts is DATA and must stay readable by someone who is asking
// "what is this rule and who is excused", without a scanner in the way.
//
// The scanning rules here are not new. They are [EEN-SCHRIJFPAD]'s, lifted so a second rule does
// not have to re-derive them — and two of them are the difference between a gate that measures
// what it claims and one that passes for the wrong reason:
//
//   · COMMENTS ARE STRIPPED FIRST. A door that mentions a rule in a comment explaining why it
//     does NOT call it would otherwise read as a door that calls it. This is the same trap
//     AGENTS.md records for gate windows, and it caught the re-measurement of R0 within the hour.
//
//   · THE TABLE IS THE NEAREST PRECEDING .from(). A file may touch five tables. "Does this file
//     mention invoices" answered for 33 files, nearly all of them readers.

import { readdirSync, readFileSync, statSync } from "node:fs";
import type { DoorQuery } from "./register";

/** Comment-stripped source. Strings are left alone: a needle inside one is a real occurrence. */
export function sourceOf(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * The same source with its IMPORT statements removed.
 *
 * This is not tidiness. A rule's needle names the owner's export, and that name also appears on
 * the import line of every door that uses it — so "does this door call the rule" is satisfied by
 * the import alone, and a door that imports the rule and then calls something else reads as
 * compliant. Measured: mutating the upload door's call from resolveSupplierAtIntake back to
 * resolveSupplierForImport left the import untouched, and the gate stayed green.
 *
 * It breaks the ordering check the same way, and worse: an import sits at the top of the file, so
 * `search(mustCall)` returns a position before every write, and "the rule is asked BEFORE the
 * thing it guards" is true by construction for every door forever.
 */
export function withoutImports(src: string): string {
  return src.replace(/^\s*import\s[\s\S]*?from\s*["'][^"']+["'];?/gm, "");
}

/**
 * Every product source file.
 *
 * Tests are not doors; they are where doors are proved. And neither is this directory: the
 * register NAMES the writes it protects, so its own text contains them, and it matched itself as
 * a door for manual-pay-key on the first re-measurement. It passed — because the register also
 * contains the needle, inside the regex that defines the needle — which is passing for the wrong
 * reason twice over. Worse, the day somebody reworded the register it would have gone red as a
 * DOOR, and the failure would have named a file that books nothing.
 */
export const NOT_DOORS = ["src/lib/rules/"];

export function productFiles(root = "src"): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full) && !full.includes(".test.") &&
               !NOT_DOORS.some((d) => full.startsWith(d))) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

/**
 * The body of a write, balanced from its opening brace.
 *
 * A fixed-length slice would cut a long insert in half and read the fields after the cut as
 * absent — which on an `.insert({…})` of thirty columns is most of them.
 */
function objectBody(src: string, fromIndex: number): string {
  const open = src.indexOf("{", fromIndex);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** Where in `src` the query's subject occurs, or -1. Used for the ordering check. */
export function firstMatchIndex(src: string, query: DoorQuery): number {
  if (query.kind === "calls") return src.search(query.needle);
  for (const m of src.matchAll(/\.(?:update|insert|upsert)\(\s*\{/g)) {
    const before = [...src.slice(0, m.index ?? 0).matchAll(/\.from\(\s*["']([a-z_]+)["']\s*\)/g)];
    if (before[before.length - 1]?.[1] !== query.table) continue;
    if (query.body.test(objectBody(src, m.index ?? 0))) return m.index ?? 0;
  }
  return -1;
}

/**
 * The doors this rule stands in front of, derived from the repository as it is right now.
 *
 * Never reads a list. A file that performs the protected write is in this set whether or not
 * anybody remembered to register it — which is the entire point.
 */
export function deriveDoors(query: DoorQuery, root = "src"): string[] {
  return productFiles(root).filter((path) => firstMatchIndex(sourceOf(path), query) >= 0);
}
