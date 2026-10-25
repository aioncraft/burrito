import type { ProjectConfig } from "../config.ts";
import { hasCommittedFile, inspectRepository } from "../git.ts";
import type { FileChange } from "../git.ts";

export interface StatusReport {
  config: string;
  engine: string;
  baseline: string;
  head: string;
  baselineMatches: boolean;
  changes: FileChange[];
}

export async function getStatus(config: ProjectConfig): Promise<StatusReport> {
  const repository = await inspectRepository(config.engine.path, config.engine.revision);
  for (const name of ["mach", "moz.build"]) {
    if (!(await hasCommittedFile(repository.root, repository.baseline, name))) {
      throw new Error(`Baseline is missing a Firefox ${name} file`);
    }
  }

  return {
    config: config.file,
    engine: repository.root,
    baseline: repository.baseline,
    head: repository.head,
    baselineMatches: repository.baselineMatches,
    changes: repository.changes,
  };
}

export function formatStatus(report: StatusReport): string {
  const lines = [
    `Engine: ${JSON.stringify(report.engine)}`,
    `HEAD: ${report.head}`,
    `Baseline: ${report.baseline} (${report.baselineMatches ? "matches" : "differs from HEAD"})`,
  ];
  if (report.changes.length === 0) {
    lines.push("Working tree: clean");
  } else {
    lines.push("Changes (index / working tree):");
    for (const change of report.changes) {
      const previous = change.originalPath === undefined ? "" : `${JSON.stringify(change.originalPath)} -> `;
      lines.push(`  ${change.indexStatus}${change.worktreeStatus} ${previous}${JSON.stringify(change.path)}`);
    }
  }
  return lines.join("\n");
}
