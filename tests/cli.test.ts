import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { spawn, which } from "bun";
import { afterEach, expect, test } from "bun:test";

import { createFixture, git, UNTRACKED_FILE_NAME } from "./helpers.ts";
import type { Fixture } from "./helpers.ts";

const entry = fileURLToPath(new URL("../bin/burrito.ts", import.meta.url));
const fixtures: Fixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => rm(fixture.root, { recursive: true, force: true })));
});

async function fixture(): Promise<Fixture> {
  const result = await createFixture();
  fixtures.push(result);
  return result;
}

async function cli(args: readonly string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const child = spawn([process.execPath, entry, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

test("JSON output inspects the configured checkout despite inherited Git context", async () => {
  const project = await fixture();
  const other = await fixture();
  await writeFile(join(project.engine, UNTRACKED_FILE_NAME), "local change\n");
  const indexPath = join(project.engine, ".git/index");
  const index = await readFile(indexPath);
  const result = await cli(["status", "--config", project.config, "--json"], other.root, {
    GIT_DIR: join(other.engine, ".git"),
    GIT_WORK_TREE: other.engine,
    GIT_INDEX_FILE: join(other.engine, ".git/index"),
  });

  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  const report = JSON.parse(result.stdout);
  expect(report.engine).toBe(project.engine);
  expect(report.head).toBe(project.revision);
  expect(report.changes).toEqual([
    { path: UNTRACKED_FILE_NAME, indexStatus: "?", worktreeStatus: "?" },
  ]);
  expect(await readFile(indexPath)).toEqual(index);
  expect(git(other.engine, "status", "--porcelain=v1")).toBe("");
});

test("uses the current project's config and escapes unusual filenames in terminal output", async () => {
  const project = await fixture();
  await writeFile(join(project.engine, UNTRACKED_FILE_NAME), "new file\n");
  const result = await cli(["status"], project.root);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("(matches)");
  expect(result.stdout).toContain(`?? ${JSON.stringify(UNTRACKED_FILE_NAME)}`);
  expect(result.stderr).toBe("");
});

test("invalid TOML reports the config path and parse error without writing JSON", async () => {
  const project = await fixture();
  await writeFile(project.config, "[engine");

  const result = await cli(["status", "--json"], project.root);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(project.config);
  expect(result.stderr).toContain("TOML Parse error");
});

test.skipIf(process.platform === "win32")("refuses a report if HEAD changes during inspection", async () => {
  const project = await fixture();
  await writeFile(join(project.engine, "tracked.txt"), "next revision\n");
  git(project.engine, "add", "tracked.txt");
  git(project.engine, "commit", "-m", "Next revision");
  const next = git(project.engine, "rev-parse", "HEAD").trim();
  git(project.engine, "reset", "--hard", project.revision);

  const realGit = which("git");
  if (realGit === null) throw new Error("Git is required for this test");
  const bin = join(project.root, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "git"), `#!/usr/bin/env bun
import { spawnSync } from "bun";
const args = process.argv.slice(2);
if (args.includes("status")) {
  const update = spawnSync([${JSON.stringify(realGit)}, "-c", ${JSON.stringify(`core.hooksPath=${join(project.root, ".unused-hooks")}`)}, "-C", ${JSON.stringify(project.engine)}, "update-ref", "HEAD", ${JSON.stringify(next)}]);
  if (update.exitCode !== 0) throw new Error(update.stderr.toString());
}
const result = spawnSync([${JSON.stringify(realGit)}, ...args]);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
`, { mode: 0o755 });

  const result = await cli(["status", "--json"], project.root, {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
  });
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("HEAD changed during inspection");
});

test.each([{ args: ["--help"] }, { args: [] }])("help does not require a browser project: %j", async ({ args }) => {
  const result = await cli(args, dirname(entry));
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("Usage: burrito status");
  expect(result.stderr).toBe("");
});

test.each([
  { args: ["status", "--json"] },
  { args: ["unknown"] },
  { args: ["status", "--unknown"] },
  { args: ["--json"] },
])(
  "errors keep stdout empty and return failure: %j",
  async ({ args }) => {
    const result = await cli(args, dirname(entry));
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toStartWith("burrito:");
  },
);
