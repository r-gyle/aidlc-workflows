// covers: hook:aidlc-plan-approval-guard
//
// The cross-artifact link rule lived only in stage-protocol prose, and a real
// run wrote 23 artifacts with 0 links and 26 bare mentions. The plan-approval
// guard now refuses an artifact write that names another existing artifact
// without linking it, before any fence logic, and names the exact link. Only
// unambiguous names that resolve inside the active record or its space's code
// knowledge base count; an Edit is judged on the text it adds.

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { unlinkedArtifactMentions } from "../../core/hooks/link-guard.ts";
import {
  AIDLC_SRC,
  cleanupTestProject,
  createTestProject,
  FIXTURES_DIR,
  seedAidlcMemory,
  seededRecordDir,
  seedStateFile,
} from "../harness/fixtures.ts";

const BUN = process.execPath;
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) cleanupTestProject(tempDirs.pop()!);
});

function touch(path: string, body = "# x\n"): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf-8");
}

// A running workflow with a few artifacts already on disk.
function project(): { proj: string; record: string; target: string } {
  const proj = createTestProject();
  tempDirs.push(proj);
  seedAidlcMemory(proj);
  seedStateFile(proj, join(FIXTURES_DIR, "state-mid-ideation.md"));
  const record = seededRecordDir(proj);
  touch(join(record, "construction", "build-and-test", "test-results.md"));
  touch(join(record, "construction", "build-and-test", "memory.md"));
  touch(join(record, "inception", "requirements-analysis", "memory.md"));
  touch(join(dirname(dirname(record)), "codekb", "priced-in", "architecture.md"));
  return { proj, record, target: join(record, "inception", "requirements-analysis", "requirements.md") };
}

const write = (file: string, content: string) => ({ tool_name: "Write", tool_input: { file_path: file, content } });

describe("t355 which mentions count", () => {
  test("a bare mention of an existing artifact is flagged with its relative link", () => {
    const { proj, target } = project();
    expect(unlinkedArtifactMentions(write(target, "Results are in `test-results.md`."), proj)).toEqual([
      { name: "test-results.md", link: "[test-results.md](../../construction/build-and-test/test-results.md)" },
    ]);
  });

  test("a code knowledge base artifact is flagged too", () => {
    const { proj, target } = project();
    const [mention] = unlinkedArtifactMentions(write(target, "See architecture.md for the stages."), proj);
    expect(mention.name).toBe("architecture.md");
    expect(mention.link).toMatch(/^\[architecture\.md\]\(\.\.\/.*codekb\/priced-in\/architecture\.md\)$/);
  });

  test("links, code blocks, ambiguous, missing, and outside names pass", () => {
    const { proj, target } = project();
    const text = [
      "Linked: [test-results.md](../../construction/build-and-test/test-results.md).",
      "```",
      "test-results.md",
      "```",
      "Every stage keeps a memory.md diary.",
      "Later we write code-summary.md.",
      "The README.md explains setup.",
    ].join("\n");
    expect(unlinkedArtifactMentions(write(target, text), proj)).toEqual([]);
  });

  test("an Edit is judged on the text it adds", () => {
    const { proj, target } = project();
    touch(target, "Old prose names test-results.md without a link.\n");
    const keepsOld = { tool_name: "Edit", tool_input: { file_path: target, old_string: "Old", new_string: "Older" } };
    expect(unlinkedArtifactMentions(keepsOld, proj)).toEqual([]);
    const addsMention = { tool_name: "Edit", tool_input: { file_path: target, old_string: "Old", new_string: "See test-results.md." } };
    expect(unlinkedArtifactMentions(addsMention, proj).map((m) => m.name)).toEqual(["test-results.md"]);
  });

  test("writes outside the record, to the audit trail, or to non-markdown are not checked", () => {
    const { proj, record } = project();
    const mention = "See test-results.md.";
    expect(unlinkedArtifactMentions(write(join(proj, "docs", "notes.md"), mention), proj)).toEqual([]);
    expect(unlinkedArtifactMentions(write(join(record, "audit", "host-x.md"), mention), proj)).toEqual([]);
    expect(unlinkedArtifactMentions(write(join(record, "notes.txt"), mention), proj)).toEqual([]);
  });
});

describe("t355 the guard enforces it before any fence", () => {
  // The installed hook and its tools, as an install lays them out.
  function install(proj: string): void {
    for (const dir of ["hooks", "tools"]) {
      cpSync(join(AIDLC_SRC, dir), join(proj, ".claude", dir), { recursive: true });
    }
  }

  function runGuard(proj: string, payload: object, env: Record<string, string> = {}) {
    const r = spawnSync(BUN, [join(proj, ".claude", "hooks", "aidlc-plan-approval-guard.ts")], {
      input: JSON.stringify(payload),
      env: { ...process.env, CLAUDE_PROJECT_DIR: proj, ...env },
      encoding: "utf-8",
    });
    return { code: r.status ?? -1, stderr: r.stderr ?? "" };
  }

  test("an unlinked mention is refused with the exact link; the linked version is allowed", () => {
    const { proj, target } = project();
    install(proj);
    const refused = runGuard(proj, write(target, "Results are in test-results.md."));
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("ARTIFACT_LINK_REQUIRED");
    expect(refused.stderr).toContain("[test-results.md](../../construction/build-and-test/test-results.md)");
    const allowed = runGuard(proj, write(target, "Results are in [test-results.md](../../construction/build-and-test/test-results.md)."));
    expect(allowed.code).toBe(0);
  });

  test("the plan-approval off-switch leaves it on; its own switch turns it off", () => {
    const { proj, target } = project();
    install(proj);
    const payload = write(target, "Results are in test-results.md.");
    expect(runGuard(proj, payload, { AIDLC_DISABLE_PLAN_APPROVAL_GUARD: "1" }).code).toBe(2);
    expect(runGuard(proj, payload, { AIDLC_DISABLE_LINK_GUARD: "1" }).code).toBe(0);
  });
});
