// Checks that the version is the same everywhere it is written, and that CHANGELOG.md has a
// section for it on top. Part of `pnpm verify`; the rule is in AGENTS.md under "Versions".
import { readFileSync } from "node:fs";

// A byte-order mark is dropped, so a file saved with one is read rather than refused.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/^\uFEFF/, "");
const problems = [];
const SEMVER = /^\d+\.\d+\.\d+$/;

const changelog = read("CHANGELOG.md");
const headings = [...changelog.matchAll(/^## (\S+) - (\d{4}-\d{2}-\d{2})\s*$/gm)].map((m) => ({ version: m[1], date: m[2] }));
// Every section heading must be a version heading: one written otherwise would be passed over,
// and the version above it taken for the newest.
for (const m of changelog.matchAll(/^## .*$/gm)) {
  if (!/^## \S+ - \d{4}-\d{2}-\d{2}\s*$/.test(m[0])) problems.push(`CHANGELOG.md: "${m[0].trim()}" is not a heading of the form '## X.Y.Z - YYYY-MM-DD'`);
}
if (/^## Unreleased/im.test(changelog)) problems.push("CHANGELOG.md has an Unreleased section; each change set gets a numbered one");
if (!headings.length) problems.push("CHANGELOG.md has no '## X.Y.Z - YYYY-MM-DD' heading");
const latest = headings[0]?.version;

const found = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "src-tauri/Cargo.toml": /^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1],
  "src-tauri/Cargo.lock": /^name = "emquad"\r?\nversion = "([^"]+)"/m.exec(read("src-tauri/Cargo.lock"))?.[1],
  "README.md": /^Current version: `([^`]+)`\./m.exec(read("README.md"))?.[1],
  "CHANGELOG.md": latest,
};
for (const [file, version] of Object.entries(found)) {
  if (!version) problems.push(`${file}: no version found`);
  else if (version !== latest) problems.push(`${file} says ${version}, but the newest CHANGELOG.md heading is ${latest}`);
}

// Headings are numbered versions, newest first, each once, and none dated in the future.
const order = (v) => v.split(".").map(Number);
const newer = (a, b) => {
  const [x, y] = [order(a), order(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
headings.forEach(({ version, date }, i) => {
  if (!SEMVER.test(version)) problems.push(`CHANGELOG.md: ${version} is not a version of the form X.Y.Z`);
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) problems.push(`CHANGELOG.md: ${version} is dated ${date}, which is not a date`);
  else if (date > tomorrow) problems.push(`CHANGELOG.md: ${version} is dated ${date}, in the future`);
  const next = headings[i + 1];
  if (next && SEMVER.test(next.version) && !newer(version, next.version)) problems.push(`CHANGELOG.md: ${version} is listed above ${next.version}, which is not older`);
  if (next && next.date > date) problems.push(`CHANGELOG.md: ${version} (${date}) is dated before the older ${next.version} (${next.date})`);
});

if (problems.length) {
  console.error(`Version check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Version ${latest}: the same in ${Object.keys(found).length} places, and CHANGELOG.md is in order.`);
