import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const docsDir = path.join(root, "docs");
const screenshotDir = path.join(docsDir, "screenshots");

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) entries.push(...walk(fullPath));
    else entries.push(fullPath);
  }
  return entries;
}

function stripAnchor(target) {
  return target.split("#")[0];
}

function isExternal(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("mailto:");
}

function localTargetExists(fromFile, target) {
  const cleanTarget = stripAnchor(target);
  if (!cleanTarget || isExternal(cleanTarget)) return true;
  const decoded = decodeURIComponent(cleanTarget);
  const resolved = path.resolve(path.dirname(fromFile), decoded);
  return existsSync(resolved);
}

function markdownTargets(content) {
  const targets = [];
  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = linkPattern.exec(content)) !== null) {
    targets.push(match[1]);
  }
  return targets;
}

const errors = [];
const markdownFiles = walk(docsDir).filter((file) => file.endsWith(".md"));

for (const file of markdownFiles) {
  const content = readFileSync(file, "utf8");
  for (const target of markdownTargets(content)) {
    if (!localTargetExists(file, target)) {
      errors.push(`${path.relative(root, file)} links to missing target ${target}`);
    }
  }
}

const expectedScreenshots = new Set();
for (const file of markdownFiles) {
  const content = readFileSync(file, "utf8");
  for (const target of markdownTargets(content)) {
    const cleanTarget = stripAnchor(target);
    if (cleanTarget.includes("screenshots/") && cleanTarget.endsWith(".png")) {
      expectedScreenshots.add(path.basename(cleanTarget));
    }
  }
}

const actualScreenshots = new Set(
  readdirSync(screenshotDir).filter((name) => name.endsWith(".png")),
);

for (const name of expectedScreenshots) {
  if (!actualScreenshots.has(name)) {
    errors.push(`docs/screenshots/${name} is referenced but missing`);
  }
}

if (actualScreenshots.size < 30) {
  errors.push(`expected at least 30 canonical screenshots, found ${actualScreenshots.size}`);
}

if (errors.length > 0) {
  console.error("Documentation validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Documentation validation passed: ${markdownFiles.length} Markdown files, ${actualScreenshots.size} screenshots.`);
