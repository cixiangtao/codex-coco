import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const exec = promisify(execFile);
const { stdout } = await exec(
  "pnpm",
  ["--filter", "@codex-coco/desktop", "list", "--prod", "--depth", "Infinity", "--json"],
  { maxBuffer: 16 * 1024 * 1024 },
);
const packages = new Map();
function visit(node) {
  if (node.path) packages.set(node.path, node);
  for (const child of Object.values(node.dependencies ?? {})) visit(child);
}
JSON.parse(stdout).forEach(visit);
const sections = [];
for (const [directory] of packages) {
  const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  if (pkg.name.startsWith("@codex-coco/")) continue;
  const names = (await readdir(directory))
    .filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name))
    .sort();
  if (!names.length && pkg.name !== "lazy-val")
    throw new Error(`Missing license text for ${pkg.name}@${pkg.version}`);
  const texts = names.length
    ? await Promise.all(names.map((name) => readFile(join(directory, name), "utf8")))
    : [await readFile("apps/desktop/resources/licenses/lazy-val.txt", "utf8")];
  if (texts.some((text) => !text.trim())) throw new Error(`Empty license text for ${pkg.name}`);
  sections.push(
    `${pkg.name}@${pkg.version}\nLicense: ${typeof pkg.license === "string" ? pkg.license : "see package notice"}\n\n${texts.join("\n\n")}`,
  );
}
await mkdir("work/release", { recursive: true });
await writeFile(
  "work/release/THIRD_PARTY_LICENSES.txt",
  "Codex Coco production dependency notices\n\n" +
    sections.sort().join("\n\n========================================\n\n"),
);
console.log(`Collected ${sections.length} production dependency notices; no local paths included.`);
