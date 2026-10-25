import { parseArgs } from "node:util";

import { formatStatus, getStatus } from "./commands/status.ts";
import { loadConfig } from "./config.ts";

const HELP = `Usage: burrito status [options]

Inspect a Firefox checkout without changing its files or Git index.

Options:
  -c, --config <file>  Project configuration (default: ./burrito.toml)
      --json           Write the status report as JSON
  -h, --help           Show this help
`;

function errorMessage(error: unknown): string {
  const messages: string[] = [];
  let current = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  if (current !== undefined) messages.push(String(current));
  return messages.join(": ");
}

export async function main(args: string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        config: { type: "string", short: "c" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help || args.length === 0) {
      process.stdout.write(HELP);
      return 0;
    }
    if (positionals.length !== 1 || positionals[0] !== "status") {
      throw new Error("Expected the status command; use --help for usage");
    }

    const report = await getStatus(await loadConfig(values.config));
    process.stdout.write(`${values.json ? JSON.stringify(report, null, 2) : formatStatus(report)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`burrito: ${errorMessage(error)}\n`);
    return 1;
  }
}
