import { realpath, stat } from "node:fs/promises";

import { spawn } from "bun";

export type FileStatus = " " | "M" | "T" | "A" | "D" | "R" | "C" | "U" | "?" | "!";

export interface FileChange {
  path: string;
  indexStatus: FileStatus;
  worktreeStatus: FileStatus;
  originalPath?: string;
}

export interface RepositoryStatus {
  root: string;
  baseline: string;
  head: string;
  baselineMatches: boolean;
  changes: FileChange[];
}

async function git(directory: string, args: string[]): Promise<string> {
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_PREFIX",
  ]) {
    delete env[key];
  }

  let child;
  try {
    child = spawn(["git", "--no-optional-locks", "-C", directory, ...args], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (cause) {
    throw new Error("Cannot start Git; check that Git is installed and on PATH", { cause });
  }

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(`Git ${args[0]} failed in ${JSON.stringify(directory)}: ${stderr.trim()}`);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(stdout);
}

function isFileStatus(value: string | undefined): value is FileStatus {
  return value !== undefined && value.length === 1 && " MTADRCU?!".includes(value);
}

export function parseStatus(output: string): FileChange[] {
  if (output.length === 0) return [];
  if (!output.endsWith("\0")) {
    throw new Error("Git status output is missing its final NUL delimiter");
  }

  const records = output.slice(0, -1).split("\0");
  const changes: FileChange[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || record.length < 4 || record[2] !== " ") {
      throw new Error("Git status output contains a malformed record");
    }
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    if (!isFileStatus(indexStatus) || !isFileStatus(worktreeStatus)) {
      throw new Error("Git status output contains an unknown change code");
    }
    const change: FileChange = { path: record.slice(3), indexStatus, worktreeStatus };
    if ([indexStatus, worktreeStatus].some((status) => status === "R" || status === "C")) {
      const originalPath = records[++i];
      if (!originalPath) {
        throw new Error("Git status rename or copy is missing its original path");
      }
      change.originalPath = originalPath;
    }
    changes.push(change);
  }
  return changes;
}

export async function inspectRepository(
  directory: string,
  revision: string,
): Promise<RepositoryStatus> {
  let root: string;
  try {
    root = await realpath(directory);
    if (!(await stat(root)).isDirectory()) {
      throw new Error("Engine path is not a directory");
    }
  } catch (cause) {
    throw new Error(`Cannot open engine directory ${JSON.stringify(directory)}`, { cause });
  }

  const topLevel = (await git(root, ["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
  if ((await realpath(topLevel)) !== root) {
    throw new Error(
      `Engine must be a Git repository root; ${JSON.stringify(root)} belongs to ${JSON.stringify(topLevel)}`,
    );
  }

  const head = (await git(root, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  let baseline: string;
  try {
    baseline = (
      await git(root, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`])
    ).trim();
    if (baseline !== revision) {
      throw new Error("The revision must identify a commit object directly");
    }
  } catch (cause) {
    throw new Error(`Cannot resolve engine.revision ${revision} to a local commit`, { cause });
  }

  const changes = parseStatus(
    await git(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
      "--renames",
    ]),
  );
  const currentHead = (await git(root, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  if (currentHead !== head) {
    throw new Error("HEAD changed during inspection; run status again");
  }
  return { root, baseline, head, baselineMatches: baseline === head, changes };
}
