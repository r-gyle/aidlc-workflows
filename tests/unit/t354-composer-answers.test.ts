// covers: subcommand:aidlc-orchestrate:next
//
// The person's answers to the composer's questions used to travel only in the
// conductor's re-dispatch, while the workflow was created from the stored
// request: the answers shaped the plan but never reached the created workflow,
// so a later stage could ask them again. `next compose --request <id>
// --with-answers` now reads them from an engine-named file and adds them to the
// stored request, so the re-dispatch, the approval, and the created workflow
// all carry them.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { authoritativeProjectDescription, composerAnswersPath } from "../../core/tools/aidlc-lib.ts";
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
const REQUEST = "make the trading pipeline handle broker failures properly";
const ANSWERS = "1. Which failures count? Timeouts and rejected orders, not partial fills.\n2. Fallback? Skip that trade and log it.";
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) cleanupTestProject(tempDirs.pop()!);
});

function project(state?: string): string {
  const proj = createTestProject();
  tempDirs.push(proj);
  seedAidlcMemory(proj);
  if (state) seedStateFile(proj, join(FIXTURES_DIR, state));
  return proj;
}

function next(proj: string, args: string[]): { kind?: string; message?: string } {
  const res = runOrchestrateNext(ORCH, proj, args, { cwd: proj, env: process.env });
  const line = res.out.split("\n").find((entry) => entry.trim().startsWith("{"));
  if (line === undefined) throw new Error(`no directive in: ${res.out}`);
  return JSON.parse(line) as { kind?: string; message?: string };
}

function approvalRequestId(message: string): string {
  const match = message.match(/On approval, run `next --scope <scopeName> --request (\S+?)`/);
  if (!match) throw new Error(`no approval request in: ${message}`);
  return match[1];
}

function writeAnswers(proj: string, text: string): string {
  const path = composerAnswersPath(proj);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf-8");
  return path;
}

// Compose once, answer, and return the id the answered plan is approved under.
function composeAndAnswer(proj: string, request = REQUEST): { first: string; answered: string; message: string } {
  const first = approvalRequestId(next(proj, ["compose", request]).message!);
  const path = writeAnswers(proj, ANSWERS);
  const dispatch = next(proj, ["compose", "--request", first, "--with-answers"]);
  expect(dispatch.kind).toBe("print");
  // The file is consumed so a later plan cannot pick up stale answers.
  expect(existsSync(path)).toBe(false);
  return { first, answered: approvalRequestId(dispatch.message!), message: dispatch.message! };
}

describe("t354 answers join the stored request", () => {
  test("the answered request carries the original text and the answers, and approval uses it", () => {
    const proj = project();
    const { first, answered, message } = composeAndAnswer(proj);
    expect(answered).not.toBe(first);
    const stored = readQuestion(proj, answered)!;
    expect(stored.origin).toBe("front");
    expect(stored.text).toBe(`${REQUEST}\n\nAnswers to the composer's questions:\n${ANSWERS}`);
    // The re-dispatch names the combined text as the task.
    expect(message).toContain("Answers to the composer's questions:");
    const created = next(proj, ["--scope", "bugfix", "--request", answered]);
    expect(created.kind).toBe("print");
    expect(created.message).toContain(`--request ${answered}`);
  });

  test("over a completed workflow the answered plan still starts a new workflow", () => {
    const proj = project("state-completed.md");
    const { answered } = composeAndAnswer(proj);
    const created = next(proj, ["--scope", "bugfix", "--request", answered]);
    expect(created.message).toContain("to start the new intent");
  });

  test("answers go before a pasted document, which must stay last", () => {
    const proj = project();
    const request = `${REQUEST}\n<document>\nbroker error codes\n</document>`;
    const { answered } = composeAndAnswer(proj, request);
    const text = readQuestion(proj, answered)!.text;
    expect(text.indexOf("Answers to the composer's questions:")).toBeLessThan(text.indexOf("<document>"));
    expect(text.trimEnd().endsWith("</document>")).toBe(true);
    expect(authoritativeProjectDescription(text).error).toBeUndefined();
  });
});

describe("t354 refusals name what to do", () => {
  test("a missing answers file names the path to write", () => {
    const proj = project();
    const first = approvalRequestId(next(proj, ["compose", REQUEST]).message!);
    const refused = next(proj, ["compose", "--request", first, "--with-answers"]) as { kind?: string; message?: string; reason?: string };
    expect(refused.kind).toBe("error");
    expect(JSON.stringify(refused)).toContain("composer-answers.md");
  });

  test("an empty answers file is refused", () => {
    const proj = project();
    const first = approvalRequestId(next(proj, ["compose", REQUEST]).message!);
    writeAnswers(proj, "  \n");
    const refused = next(proj, ["compose", "--request", first, "--with-answers"]);
    expect(refused.kind).toBe("error");
    expect(JSON.stringify(refused)).toContain("is empty");
  });

  test("an in-flight reshape and a non-compose command refuse --with-answers", () => {
    const running = project("state-mid-ideation.md");
    expect(next(running, ["compose", "skip market research", "--with-answers"]).kind).toBe("error");
    expect(next(project(), ["--with-answers"]).kind).toBe("error");
  });
});
