import { expect, test } from "bun:test";

import { parseStatus } from "../src/git.ts";

test.each([
  { code: "R ", index: "R", worktree: " " },
  { code: " R", index: " ", worktree: "R" },
  { code: "C ", index: "C", worktree: " " },
  { code: " C", index: " ", worktree: "C" },
] as const)("consumes both paths for a rename or copy: %j", ({ code, index, worktree }) => {
  const changes = parseStatus(`${code} new name\nΩ.txt\0old -> name.txt\0?? next.txt\0`);
  expect(changes).toHaveLength(2);
  expect(changes[0]?.path).toBe("new name\nΩ.txt");
  expect(changes[0]?.originalPath).toBe("old -> name.txt");
  expect(changes[0]?.indexStatus).toBe(index);
  expect(changes[0]?.worktreeStatus).toBe(worktree);
  expect(changes[1]).toEqual({ path: "next.txt", indexStatus: "?", worktreeStatus: "?" });
});

test.each([" M truncated", "R  new.txt\0", "bad\0", "ZZ file.txt\0", "?? file\0\0"])(
  "rejects malformed or truncated status %j",
  (output) => expect(() => parseStatus(output)).toThrow(),
);
