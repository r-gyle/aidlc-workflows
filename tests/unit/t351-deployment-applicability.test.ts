// covers: stage:operation/deployment-pipeline, stage:operation/deployment-execution
//
// The deployment stages decide whether they apply before asking anything. A
// brownfield bugfix on a project with no deployment target used to fall
// straight into Deployment Pipeline's strategy questions, because the
// no-target skip was written for Express greenfield only. These pins keep the
// applicability check ahead of the questions, keep the per-scope rules, and
// keep Deployment Execution following the pipeline stage's recorded reason.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const read = (...parts: string[]): string => readFileSync(join(REPO_ROOT, ...parts), "utf-8");
const stage = (slug: string): string => read("core", "aidlc-common", "stages", "operation", `${slug}.md`);
const scope = (name: string): string => read("core", "scopes", `aidlc-${name}.md`);

const tableRow = (body: string, evidence: string, scopes: string): string => {
  const row = body.split("\n").find((line) => line.startsWith(`| ${evidence} | ${scopes} |`));
  if (!row) throw new Error(`no applicability row for "${evidence}" / "${scopes}"`);
  return row;
};

describe("t351 deployment pipeline applicability check", () => {
  const pipeline = stage("deployment-pipeline");

  test("the check runs before any clarifying question", () => {
    const check = pipeline.indexOf("#### Applicability check (every scope, before any question)");
    const questions = pipeline.indexOf("### Step 2: Generate Clarifying Questions");
    expect(check).toBeGreaterThan(-1);
    expect(questions).toBeGreaterThan(check);
  });

  test("a Dockerfile or build script alone is not a deployable target", () => {
    expect(pipeline).toContain("A Dockerfile or build script\non its own is not a target.");
  });

  test("incremental scopes without a target skip; security-patch asks", () => {
    expect(tableRow(pipeline, "No target", "`bugfix`, `refactor`, `express`")).toContain("Report skipped");
    expect(tableRow(pipeline, "No target", "`security-patch`")).toContain("Ask the question below");
    expect(tableRow(pipeline, "No target", "any other scope")).toContain("otherwise ask the question below");
  });

  test("an adequate existing pipeline skips, and ambiguous evidence asks", () => {
    expect(tableRow(pipeline, "Active target, and the approved requirements need no change to how it ships", "any"))
      .toContain("Report skipped: the existing pipeline is adequate");
    expect(tableRow(pipeline, "Ambiguous: a disabled or commented-out pipeline, or deploy scripts with no clear target", "any"))
      .toContain("Ask the question below");
  });

  test("the skip goes through the engine with an evidence-naming reason", () => {
    expect(pipeline).toContain(
      '{{INVOKE}} engine orchestrate report --stage deployment-pipeline --result skipped --reason "<evidence checked and why this stage does not apply>"',
    );
  });

  test("the question is logged as a non-gate decision with its exact labels", () => {
    expect(pipeline).toContain(
      '{{INVOKE}} engine log decision --stage deployment-pipeline --decision "<what was and was not found>" --options "Skip deployment for this change,Set up deployment"',
    );
    expect(pipeline).toContain('{{INVOKE}} engine log answer --stage deployment-pipeline --details "<exact choice>"');
    expect(pipeline).toContain("  - label: Skip deployment for this change\n");
    expect(pipeline).toContain("  - label: Set up deployment\n");
  });

  test("the no-target skip is no longer limited to Express greenfield", () => {
    expect(pipeline).not.toContain("if no deployable target\nexists, this CONDITIONAL stage reports skipped");
  });
});

describe("t351 deployment execution follows the pipeline stage's reason", () => {
  const execution = stage("deployment-execution");

  test("it reads the recorded skip before any pre-deployment question", () => {
    const history = execution.indexOf(
      "{{INVOKE}} engine audit history --stage deployment-pipeline --event STAGE_SKIPPED",
    );
    const questions = execution.indexOf("### Step 2: Pre-Deployment Checks");
    expect(history).toBeGreaterThan(-1);
    expect(questions).toBeGreaterThan(history);
  });

  test("no target or a declined deployment skips this stage too", () => {
    expect(execution).toContain(
      '{{INVOKE}} engine orchestrate report --stage deployment-execution --result skipped --reason "<Deployment Pipeline\'s recorded reason>"',
    );
    expect(execution).toContain("Ask no pre-deployment questions");
  });

  test("an adequate existing pipeline still deploys through the real configuration", () => {
    expect(execution).toContain("**Existing pipeline adequate.**");
    expect(execution).toContain("instead of invoking missing-artifact\n  recovery");
  });

  test("the Express-greenfield-only rule is gone", () => {
    expect(execution).not.toContain("For Express greenfield, deployment proceeds only when");
  });
});

describe("t351 scope prose matches the stages", () => {
  test("bugfix and refactor say the deployment stages skip without a target", () => {
    for (const name of ["bugfix", "refactor"]) {
      expect(scope(name).replace(/\s+/g, " ")).toContain(
        "When the project has no deployment target, both stages report skipped without asking deployment questions.",
      );
    }
  });

  test("security-patch says it does not skip deployment silently", () => {
    expect(scope("security-patch").replace(/\s+/g, " ")).toContain(
      "it does not skip deployment silently when the project has no deployment target",
    );
  });
});
