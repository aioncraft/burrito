import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawnSync } from "bun";

export const UNTRACKED_FILE_NAME = process.platform === "win32" ? "new file Ω.txt" : "new\nfile Ω.txt";

export interface Fixture {
  root: string;
  engine: string;
  config: string;
  revision: string;
}

export function git(directory: string, ...args: string[]): string {
  const result = spawnSync([
    "git",
    "--no-optional-locks",
    "-c", "user.name=Burrito Tests",
    "-c", "user.email=tests@example.test",
    "-c", "commit.gpgsign=false",
    "-c", `core.hooksPath=${join(directory, ".unused-hooks")}`,
    "-C", directory,
    ...args,
  ]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

export function configText(path: string, revision: string): string {
  return `version = 1\n\n[engine]\npath = ${JSON.stringify(path)}\nrevision = ${JSON.stringify(revision)}\n`;
}

export async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "burrito-test-"));
  const engine = join(root, "engine");
  const config = join(root, "burrito.toml");
  try {
    await mkdir(engine);
    git(engine, "init", "-b", "main", "--template=");
    git(engine, "config", "core.autocrlf", "false");
    git(engine, "config", "core.eol", "lf");
    git(engine, "config", "core.fsmonitor", "false");
    await Promise.all([
      writeFile(join(engine, "mach"), "#!/usr/bin/env python3\n"),
      writeFile(join(engine, "moz.build"), "DIRS = []\n"),
      writeFile(join(engine, ".gitignore"), "obj-*/\n"),
      writeFile(join(engine, "tracked.txt"), "original tracked content\n"),
      writeFile(join(engine, "deleted.txt"), "original deleted content\n"),
      writeFile(join(engine, "renamed.txt"), "original renamed content\n"),
    ]);
    git(engine, "add", ".");
    git(engine, "commit", "-m", "Fixture baseline");
    const revision = git(engine, "rev-parse", "HEAD").trim();
    await writeFile(config, configText("engine", revision));
    return { root, engine, config, revision };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
