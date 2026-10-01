// The cross-artifact link rule's deterministic twin.
//
// stage-protocol.md "Cross-artifact references" tells the agent to name another
// artifact as a relative Markdown link, never a bare filename. A real run showed
// prose losing: 23 artifacts, 0 links, 26 bare mentions. A write-time sensor
// would not help, because its findings never reach the agent, and a blocking
// gate sensor would ask the human to fix or override at every gate. This check
// runs before the write instead: it refuses an artifact write that names
// another existing artifact without linking it, and hands the agent the exact
// link, so the agent fixes it and the human never sees it.
//
// Only a name that resolves to exactly one file is flagged: a file outside the
// active record and its space's code knowledge base, a not-yet-written
// artifact, an ambiguous name (memory.md exists in every stage), and the
// engine's aidlc-state.md all pass.
// Code blocks and existing links are ignored. An Edit is judged on the text it
// adds, not on older text it leaves alone. Any error allows the write.
// AIDLC_DISABLE_LINK_GUARD=1 turns the check off.

import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type ClaudeCodeHookInput,
  recordDir,
  resolveProjectFlag,
  visibleMarkdownLines,
} from "../tools/aidlc-lib.ts";

export interface UnlinkedMention {
  name: string;
  link: string;
}

const EXCLUDED_DIRS = new Set(["audit", ".aidlc-engine", ".git", "node_modules"]);
const MAX_INDEXED_FILES = 5000;
// The engine's own progress tracker: prose that names it narrates the process,
// and a reader of an artifact gains nothing from a link to it.
const UNLINKED_NAMES = new Set(["aidlc-state.md"]);

function inside(path: string, root: string): boolean {
  return path !== root && path.startsWith(`${root}${sep}`);
}

function posix(path: string): string {
  return path.split(sep).join("/");
}

// Every markdown file under `root`, by file name.
function indexMarkdown(root: string, index: Map<string, string[]>): void {
  if (!existsSync(root)) return;
  const pending = [root];
  let seen = 0;
  for (let dir = pending.pop(); dir !== undefined && seen < MAX_INDEXED_FILES; dir = pending.pop()) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) pending.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        seen++;
        const list = index.get(entry.name) ?? [];
        list.push(path);
        index.set(entry.name, list);
      }
    }
  }
}

// The text this call adds to the target file, or null when it adds none.
function addedText(toolName: string, toolInput: Record<string, unknown>): string | null {
  if (toolName === "Write") return typeof toolInput.content === "string" ? toolInput.content : null;
  if (toolName === "Edit") return typeof toolInput.new_string === "string" ? toolInput.new_string : null;
  if (toolName === "MultiEdit" && Array.isArray(toolInput.edits)) {
    const parts = (toolInput.edits as unknown[])
      .map((edit) => (typeof edit === "object" && edit !== null ? (edit as Record<string, unknown>).new_string : null))
      .filter((value): value is string => typeof value === "string");
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null;
}

// Bare `*.md` file names in visible prose, outside code blocks and links.
function mentionedNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of visibleMarkdownLines(text)) {
    const withoutLinks = line.replace(/!?\[[^\]]*\]\([^)]*\)/g, " ");
    for (const match of withoutLinks.matchAll(/(?<![\w./-])([A-Za-z0-9][\w.-]*\.md)(?![\w/-])/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

/** Bare mentions of other artifacts that this write adds, each with the link to use. */
export function unlinkedArtifactMentions(input: ClaudeCodeHookInput, projectDir: string): UnlinkedMention[] {
  const toolName = input.tool_name ?? "";
  const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
  const rawPath = toolInput.file_path;
  if (typeof rawPath !== "string" || !rawPath.endsWith(".md")) return [];
  const added = addedText(toolName, toolInput);
  if (added === null || added.length === 0) return [];

  const cwd = typeof input.cwd === "string" ? input.cwd : projectDir;
  const target = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  const record = recordDir(projectDir);
  if (record === null || !inside(target, record)) return [];
  const fromRecord = relative(record, target).split(sep);
  if (fromRecord.some((part) => EXCLUDED_DIRS.has(part))) return [];

  const names = mentionedNames(added);
  if (names.size === 0) return [];

  // The active record plus its space's code knowledge base, where reverse
  // engineering writes the artifacts other stages cite.
  const index = new Map<string, string[]>();
  indexMarkdown(record, index);
  indexMarkdown(join(dirname(dirname(record)), "codekb"), index);

  const mentions: UnlinkedMention[] = [];
  for (const name of [...names].sort()) {
    const candidates = (index.get(name) ?? []).filter((path) => path !== target);
    if (candidates.length !== 1 || basename(target) === name || UNLINKED_NAMES.has(name)) continue;
    mentions.push({ name, link: `[${name}](${posix(relative(dirname(target), candidates[0]))})` });
  }
  return mentions;
}

/** Write the refusal for a write that leaves artifacts unlinked; true when the caller must exit 2. */
export function refuseUnlinkedArtifactMentions(input: ClaudeCodeHookInput, projectDir: string): boolean {
  if (resolveProjectFlag("AIDLC_DISABLE_LINK_GUARD") === "1") return false;
  let mentions: UnlinkedMention[];
  try {
    mentions = unlinkedArtifactMentions(input, projectDir);
  } catch {
    return false;
  }
  if (mentions.length === 0) return false;
  const fixes = mentions.map((mention) => `\`${mention.name}\` -> ${mention.link}`).join("; ");
  process.stderr.write(`${JSON.stringify({
    error:
      "This artifact names other artifacts without linking them. Per the stage protocol's " +
      `Cross-artifact references rule, write each one as this relative Markdown link and retry: ${fixes}.`,
    code: "ARTIFACT_LINK_REQUIRED",
  })}\n`);
  return true;
}
