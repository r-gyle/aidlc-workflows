// covers: subcommand:aidlc-orchestrate:next
//
// Compose treated any active workflow as the one to reshape, including one that
// had already completed. A completed workflow has no pending stages, so new work
// asked for there went to an in-flight composer that could only decline it, and
// the new-work question's compose choice led to the same dead end. Compose over
// a completed workflow now plans the request as new work, and its approval
// creates a new intent beside the completed one. A running workflow still
// reshapes as before.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readQuestion } from "../../core/tools/aidlc-question-store.ts";
import {
  AIDLC_SRC,
  cleanupTestProject,
  createTestProject,
  FIXTURES_DIR,
  runOrchestrateNext,
  seedAidlcMemory,
  seedStateFile,
} from "../harness/fixtures.ts";

const ORCH = join(AIDLC_SRC, "tools", "aidlc-orchestrate.ts");
const REPO_ROOT = join(import.meta.dir, "..", "..");
const REQUEST = "make the trading pipeline handle broker failures properly";
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) cleanupTestProject(tempDirs.pop()!);
});

function project(state: string): string {
  const proj = createTestProject();
  tempDirs.push(proj);
  seedAidlcMemory(proj);
  seedStateFile(proj, join(FIXTURES_DIR, state));
  return proj;
}

function next(proj: string, args: string[]): { kind?: string; message?: string } {
  const res = runOrchestrateNext(ORCH, proj, args, { cwd: proj, env: process.env });
  const line = res.out.split("\n").find((entry) => entry.trim().startsWith("{"));
  if (line === undefined) throw new Error(`no directive in: ${res.out}`);
  return JSON.parse(line) as { kind?: string; message?: string };
}

// The front dispatch names the approval command with the request it saved.
function approvalRequestId(message: string): string {
  const match = message.match(/On approval, run `next --scope <scopeName> --request (\S+?)`/);
  if (!match) throw new Error(`no approval request in: ${message}`);
  return match[1];
}

function expectNewIntentCreation(proj: string, requestId: string): void {
  const created = next(proj, ["--scope", "bugfix", "--request", requestId]);
  expect(created.kind).toBe("print");
  expect(created.message).toContain(`--request ${requestId}`);
  expect(created.message).toContain("to start the new intent");
}

describe("t353 compose over a completed workflow plans new work", () => {
  test("/aidlc compose plans the request as new work, and approval creates a new intent", () => {
    const proj = project("state-completed.md");
    const dispatch = next(proj, ["compose", REQUEST]);
    expect(dispatch.kind).toBe("print");
    expect(dispatch.message).not.toContain("mode in-flight");
    expect(dispatch.message).toContain(`to propose the workflow plan for: "${REQUEST}"`);
    const id = approvalRequestId(dispatch.message!);
    expect(readQuestion(proj, id)?.origin).toBe("front");
    expectNewIntentCreation(proj, id);
  });

  test("the new-work question offers start or tailor, and tailoring plans new work", () => {
    const proj = project("state-completed.md");
    const ask = next(proj, [REQUEST]) as {
      kind?: string; ask_type?: string; question?: string; numbered_prose_question?: string; compose_command?: string;
    };
    expect(ask.kind).toBe("ask");
    expect(ask.ask_type).toBe("new-work-routing");
    // Nothing is in progress and nothing is left to reshape.
    expect(ask.question).toContain("is complete");
    expect(ask.question).not.toContain("already in progress");
    expect(ask.numbered_prose_question).toContain("**Tailor a plan first**");
    expect(ask.numbered_prose_question).not.toContain("Reshape the active work");
    expect(ask.numbered_prose_question).not.toContain("Part of the active work");

    const routingId = ask.compose_command!.match(/--request (\S+)/)![1];
    expect(readQuestion(proj, routingId)?.origin).toBe("routing");
    const dispatch = next(proj, ["compose", "--request", routingId]);
    expect(dispatch.kind).toBe("print");
    expect(dispatch.message).not.toContain("mode in-flight");
    // Its approval must answer a front request, never the routing question.
    const id = approvalRequestId(dispatch.message!);
    expect(id).not.toBe(routingId);
    expect(readQuestion(proj, id)?.origin).toBe("front");
    expect(readQuestion(proj, id)?.text).toBe(REQUEST);
    expectNewIntentCreation(proj, id);
  });

  test("a running workflow keeps its routing question and is still reshaped in flight", () => {
    const proj = project("state-mid-ideation.md");
    const ask = next(proj, [REQUEST]) as { question?: string };
    expect(ask.question).toContain("already in progress");
    expect(ask.question).toContain("(3) a change to how the remaining plan is shaped");
    const dispatch = next(proj, ["compose", "skip market research"]);
    expect(dispatch.kind).toBe("print");
    expect(dispatch.message).toContain("mode in-flight");
  });
});

describe("t353 every orchestrator routes tailor-a-plan to compose", () => {
  test("each SKILL.md maps the completed-workflow choice to compose_command", () => {
    for (const harness of ["claude", "codex", "copilot", "cursor", "kiro", "kiro-ide", "opencode"]) {
      const skill = readFileSync(join(REPO_ROOT, "harness", harness, "skills", "aidlc", "SKILL.md"), "utf-8");
      expect(skill, harness).toContain(
        'reshape, or "tailor a plan first" when the question says the last piece of work is complete, = run `directive.compose_command`',
      );
    }
  });
});
