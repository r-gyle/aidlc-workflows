// covers: file:agents/aidlc-composer-agent.md, file:knowledge/aidlc-composer-agent/composing.md
//
// The composer scores intent ambiguity from the request alone, so a vague
// request kept discovery stages in the grid and those stages then asked the
// person the same things. A front or report proposal now carries at most three
// openQuestions, each naming what its answer flips; the person approves as is
// or answers, and an answer is an edit that re-runs the composer with the
// answers carried in the task text, which lands in the creation description.
// These pins keep that contract on every composer surface and in the dispatch.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
const HEADING = "Questions that could change this plan";
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) cleanupTestProject(tempDirs.pop()!);
});

function project(): string {
  const proj = createTestProject();
  tempDirs.push(proj);
  seedAidlcMemory(proj);
  return proj;
}

function composeMessage(proj: string, args: string[]): string {
  const res = runOrchestrateNext(ORCH, proj, ["compose", ...args], { cwd: proj, env: process.env });
  const line = res.out.split("\n").find((entry) => entry.trim().startsWith("{"));
  if (line === undefined) throw new Error(`no directive in: ${res.out}`);
  const directive = JSON.parse(line) as { kind?: unknown; message?: unknown };
  expect(directive.kind).toBe("print");
  return String(directive.message);
}

const read = (surface: string): string => readFileSync(join(REPO_ROOT, surface), "utf-8");
const flat = (text: string): string => text.replace(/\s+/g, " ");
const harnesses = ["claude", "codex", "copilot", "cursor", "kiro", "kiro-ide", "opencode"];
const skills = harnesses.map((harness) => `harness/${harness}/skills/aidlc/SKILL.md`);

describe("t352 (1) every composer surface names the open-questions contract", () => {
  test("the agent, its knowledge, the dispatch, and each SKILL.md name openQuestions", () => {
    for (const surface of [
      "core/agents/aidlc-composer-agent.md",
      "core/knowledge/aidlc-composer-agent/composing.md",
      "core/tools/aidlc-orchestrate.ts",
      ...skills,
    ]) {
      expect(read(surface), surface).toContain("openQuestions");
    }
  });

  test("each SKILL.md renders them under one heading and routes an answer through re-dispatch", () => {
    for (const surface of skills) {
      const text = flat(read(surface));
      expect(text, surface).toContain(`**${HEADING}**`);
      expect(text, surface).toContain("(at most three)");
      expect(text, surface).toContain("An answer is an edit: follow the dispatch's answer route");
      expect(text, surface).toContain("`next compose --request <id> --with-answers`");
      expect(text, surface).toContain("quoted exactly, never paraphrased");
      expect(text, surface).toContain("never add your own");
    }
  });
});

describe("t352 (2) the agent asks only questions that change the plan", () => {
  const agent = flat(read("core/agents/aidlc-composer-agent.md"));

  test("front and report proposals carry at most three; in-flight carries none", () => {
    expect(agent).toContain(
      '`openQuestions` is REQUIRED for `mode: "matched"` and `mode: "custom"` (`[]` when nothing is open) and omitted for `mode: "in-flight"`',
    );
    expect(agent).toContain("It lists at most three questions");
  });

  test("a question must hinge a grid decision the evidence does not settle", () => {
    expect(agent).toContain(
      "a specific decision in your grid hinges on one fact that neither the task text, the scan, the report, nor CodeKB settles",
    );
    expect(agent).toContain("never ask a question whose every answer leaves the grid as it is");
    expect(agent).toContain("never ask about the scope settings or Guard Policy");
  });

  test("the proposal stays complete without answers, and answers persist with the request", () => {
    expect(agent).toContain("The proposal stays complete without answers");
    expect(agent).toContain("never repeat one the person answered");
    expect(agent).toContain("The engine adds the person's answers to the stored request");
    expect(agent).toContain("the workflow is created from that same stored request");
  });
});

describe("t352 (3) the compose dispatch", () => {
  test("front: the proposal shape and the gate carry the questions", () => {
    const message = composeMessage(project(), ["fix the token bug"]);
    expect(message).toContain("up to three openQuestions (each a question, its options, and which stages or setting its answer decides; [] when nothing is open)");
    expect(message).toContain(`a numbered list headed "${HEADING}"`);
    expect(message).toMatch(/run `next compose --request \S+ --with-answers`, and follow the dispatch it returns/);
  });

  test("in-flight: no questions, since completed stages are the evidence", () => {
    const proj = project();
    seedStateFile(proj, join(FIXTURES_DIR, "state-mid-ideation.md"));
    const message = composeMessage(proj, ["skip market research"]);
    expect(message).toContain("mode in-flight");
    expect(message).not.toContain("openQuestions");
    expect(message).not.toContain(HEADING);
  });
});
