import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map(normalize);
const tracked = new Set(trackedFiles);
const markdownFiles = trackedFiles.filter((file) => file.endsWith(".md"));
const failures = [];

for (const source of markdownFiles) {
  const text = readFileSync(path.join(root, source), "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, "");
    if (/^(?:https?:\/\/|mailto:|#)/i.test(target)) continue;

    const pathPart = target.split("#", 1)[0];
    if (!pathPart) continue;

    let decoded;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      failures.push(`${source}: malformed link ${target}`);
      continue;
    }

    const absolute = path.resolve(root, path.dirname(source), decoded);
    const relative = normalize(path.relative(root, absolute));
    if (relative === ".." || relative.startsWith("../")) {
      failures.push(`${source}: link escapes repository: ${target}`);
      continue;
    }
    if (!existsSync(absolute)) {
      failures.push(`${source}: missing target: ${target}`);
      continue;
    }

    if (statSync(absolute).isDirectory()) {
      const prefix = relative === "" ? "" : `${relative}/`;
      if (!trackedFiles.some((file) => file.startsWith(prefix))) {
        failures.push(`${source}: target directory has no tracked files: ${target}`);
      }
    } else if (!tracked.has(relative)) {
      failures.push(`${source}: target is not tracked by Git: ${target}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`checked ${markdownFiles.length} tracked Markdown files\n`);
}

function normalize(value) {
  return value.replaceAll(path.sep, "/");
}
