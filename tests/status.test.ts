import { mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { getStatus } from "../src/commands/status.ts";
import { loadConfig } from "../src/config.ts";
import { configText, createFixture, git, UNTRACKED_FILE_NAME } from "./helpers.ts";
import type { Fixture } from "./helpers.ts";

const fixtures: Fixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => rm(fixture.root, { recursive: true, force: true })));
});

async function fixture(): Promise<Fixture> {
  const result = await createFixture();
  fixtures.push(result);
  return result;
}

test("reports mixed changes without touching the index, HEAD, or working files", async () => {
  const project = await fixture();
  const tracked = join(project.engine, "tracked.txt");
  await writeFile(tracked, "staged content\n");
  git(project.engine, "add", "tracked.txt");
  await writeFile(tracked, "unstaged content\n");
  await unlink(join(project.engine, "deleted.txt"));
  git(project.engine, "mv", "renamed.txt", "renamed Ω file.txt");
  await writeFile(join(project.engine, UNTRACKED_FILE_NAME), "new file\n");
  await mkdir(join(project.engine, "obj-ignored"));
  await writeFile(join(project.engine, "obj-ignored/output.js"), "ignored\n");

  const indexPath = join(project.engine, ".git/index");
  const before = await readFile(indexPath);
  const mtime = (await stat(indexPath)).mtimeMs;
  const beforeStatus = git(project.engine, "status", "--porcelain=v1", "-z", "--untracked-files=all");
  const report = await getStatus(await loadConfig(project.config));

  expect(report.baselineMatches).toBe(true);
  expect(report.changes).toEqual(expect.arrayContaining([
    { path: "tracked.txt", indexStatus: "M", worktreeStatus: "M" },
    { path: "deleted.txt", indexStatus: " ", worktreeStatus: "D" },
    { path: "renamed Ω file.txt", originalPath: "renamed.txt", indexStatus: "R", worktreeStatus: " " },
    { path: UNTRACKED_FILE_NAME, indexStatus: "?", worktreeStatus: "?" },
  ]));
  expect(report.changes).toHaveLength(4);
  expect(await readFile(indexPath)).toEqual(before);
  expect((await stat(indexPath)).mtimeMs).toBe(mtime);
  expect(git(project.engine, "rev-parse", "HEAD").trim()).toBe(project.revision);
  expect(git(project.engine, "status", "--porcelain=v1", "-z", "--untracked-files=all")).toBe(beforeStatus);
  expect(await readFile(tracked, "utf8")).toBe("unstaged content\n");
});

test("supports linked worktrees with detached HEAD", async () => {
  const project = await fixture();
  const worktree = join(project.root, "linked engine");
  git(project.engine, "worktree", "add", "--detach", worktree, project.revision);
  await writeFile(project.config, configText("linked engine", project.revision));
  const report = await getStatus(await loadConfig(project.config));
  expect(report.engine).toBe(worktree);
  expect(report.baselineMatches).toBe(true);
  expect(report.changes).toEqual([]);
});

test("rejects an engine directory that resolves to its parent Git repository", async () => {
  const project = await fixture();
  git(project.root, "init", "-b", "main", "--template=");
  await mkdir(join(project.root, "empty engine"));
  await writeFile(project.config, configText("empty engine", project.revision));
  await expect(getStatus(await loadConfig(project.config))).rejects.toThrow("Git repository root");
});

test("reports a baseline mismatch without switching revisions", async () => {
  const project = await fixture();
  git(project.engine, "rm", "mach", "moz.build");
  git(project.engine, "commit", "-m", "New fixture revision");
  const head = git(project.engine, "rev-parse", "HEAD").trim();
  const report = await getStatus(await loadConfig(project.config));
  expect(report.baseline).toBe(project.revision);
  expect(report.head).toBe(head);
  expect(report.baselineMatches).toBe(false);
  expect(git(project.engine, "rev-parse", "HEAD").trim()).toBe(head);
});

test("rejects a configured commit that is unavailable locally", async () => {
  const project = await fixture();
  await writeFile(project.config, configText("engine", "f".repeat(40)));
  await expect(getStatus(await loadConfig(project.config))).rejects.toThrow("Cannot resolve engine.revision");
});

test("reports staged and unstaged deletions of Firefox's build entry points", async () => {
  const project = await fixture();
  await unlink(join(project.engine, "mach"));
  git(project.engine, "rm", "moz.build");
  const indexPath = join(project.engine, ".git/index");
  const index = await readFile(indexPath);

  const report = await getStatus(await loadConfig(project.config));
  expect(report.changes).toEqual([
    { path: "mach", indexStatus: " ", worktreeStatus: "D" },
    { path: "moz.build", indexStatus: "D", worktreeStatus: " " },
  ]);
  expect(await readFile(indexPath)).toEqual(index);
});

test("rejects a baseline without Firefox's build entry points even if they exist locally", async () => {
  const project = await fixture();
  git(project.engine, "rm", "mach");
  git(project.engine, "commit", "-m", "Remove Firefox entry point");
  await writeFile(project.config, configText("engine", git(project.engine, "rev-parse", "HEAD").trim()));
  await writeFile(join(project.engine, "mach"), "untracked file\n");

  await expect(getStatus(await loadConfig(project.config))).rejects.toThrow("Baseline is missing a Firefox mach file");
});

test("reports a missing engine without creating it", async () => {
  const project = await fixture();
  await writeFile(project.config, configText("not cloned", project.revision));
  await expect(getStatus(await loadConfig(project.config))).rejects.toThrow("Cannot open engine directory");
  expect(await stat(join(project.root, "not cloned")).catch(() => null)).toBeNull();
});
