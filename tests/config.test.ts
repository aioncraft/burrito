import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, test } from "bun:test";

import { loadConfig } from "../src/config.ts";
import { configText, createFixture } from "./helpers.ts";
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

test("resolves engine paths relative to the config file rather than the current directory", async () => {
  const project = await fixture();
  const nested = join(project.root, "config files");
  await mkdir(nested);
  await writeFile(join(nested, "project.toml"), configText("../engine", project.revision.toUpperCase()));

  const config = await loadConfig(join(nested, "project.toml"), project.engine);
  expect(config.engine).toEqual({ path: project.engine, revision: project.revision });
  expect(config.root).toBe(nested);
});

test.each([
  ["unsupported version", 'version = 2\n[engine]\npath = "engine"\nrevision = "REVISION"', "version must be 1"],
  ["unknown field", 'version = 1\nextra = true\n[engine]\npath = "engine"\nrevision = "REVISION"', "Unknown configuration field"],
  ["unknown engine field", 'version = 1\n[engine]\npath = "engine"\nrevision = "REVISION"\nrev = "main"', "Unknown engine field"],
  ["missing engine", "version = 1", "engine must be a TOML table"],
  ["non-string path", 'version = 1\n[engine]\npath = 2\nrevision = "REVISION"', "engine.path"],
  ["empty path", 'version = 1\n[engine]\npath = " "\nrevision = "REVISION"', "engine.path"],
  ["NUL path", 'version = 1\n[engine]\npath = "eng\\u0000ine"\nrevision = "REVISION"', "engine.path"],
  ["moving revision", 'version = 1\n[engine]\npath = "engine"\nrevision = "main"', "full Git commit hash"],
])("rejects %s", async (_name, text, message) => {
  const project = await fixture();
  await writeFile(project.config, text.replace("REVISION", project.revision));
  try {
    await loadConfig(project.config);
    throw new Error("Expected invalid configuration to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(project.config);
    expect(error instanceof Error && String(error.cause)).toContain(message);
  }
});

test("rejects invalid UTF-8 instead of silently changing a configured path", async () => {
  const project = await fixture();
  await writeFile(project.config, Buffer.concat([
    Buffer.from('version = 1\n[engine]\npath = "eng'),
    Buffer.from([0xff]),
    Buffer.from(`ine"\nrevision = "${project.revision}"\n`),
  ]));
  await expect(loadConfig(project.config)).rejects.toThrow("Cannot load configuration");
});
