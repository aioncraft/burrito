import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { TOML } from "bun";

export const DEFAULT_CONFIG_FILE = "burrito.toml";

export interface ProjectConfig {
  version: 1;
  file: string;
  root: string;
  engine: {
    path: string;
    revision: string;
  };
}

function table(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be a TOML table`);
  }
  return value as Record<string, unknown>;
}

function checkKeys(value: Record<string, unknown>, keys: string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw new Error(`Unknown ${name} field ${JSON.stringify(key)}`);
    }
  }
}

export async function loadConfig(
  file = DEFAULT_CONFIG_FILE,
  cwd = process.cwd(),
): Promise<ProjectConfig> {
  const configFile = resolve(cwd, file);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(configFile));
    const data = table(TOML.parse(text), "Configuration");
    checkKeys(data, ["version", "engine"], "configuration");
    if (data.version !== 1) {
      throw new Error("Configuration version must be 1");
    }

    const engine = table(data.engine, "engine");
    checkKeys(engine, ["path", "revision"], "engine");
    if (
      typeof engine.path !== "string" ||
      engine.path.trim().length === 0 ||
      engine.path.includes("\0")
    ) {
      throw new Error("engine.path must be a nonempty path without NUL characters");
    }
    if (
      typeof engine.revision !== "string" ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(engine.revision)
    ) {
      throw new Error("engine.revision must be a full Git commit hash");
    }

    const root = dirname(configFile);
    return {
      version: 1,
      file: configFile,
      root,
      engine: {
        path: resolve(root, engine.path),
        revision: engine.revision.toLowerCase(),
      },
    };
  } catch (cause) {
    throw new Error(`Cannot load configuration ${JSON.stringify(configFile)}`, { cause });
  }
}
