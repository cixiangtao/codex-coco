import { readdir, readFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "oxc-parser";

const root = fileURLToPath(new URL("../", import.meta.url));
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
async function filesIn(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const children = await Promise.all(
    entries.map((entry) => {
      const file = resolve(path, entry.name);
      return entry.isDirectory() ? filesIn(file) : /\.[cm]?tsx?$/.test(file) ? [file] : [];
    }),
  );
  return children.flat();
}

function scope(file) {
  const name = relative(root, file).split(sep).join("/");
  if (name.startsWith("packages/ui/src/")) {
    if (/\/theme\/(contract|resolve)\.ts$/.test(name)) return "pure-ui";
    return "ui";
  }
  if (name === "apps/desktop/src/modules/registry.ts") return "module-registry";
  for (const part of [
    "contracts",
    "application",
    "renderer",
    "modules",
    "desktop/preload",
    "desktop/main",
  ]) {
    if (name.startsWith(`apps/desktop/src/${part}/`)) return part;
  }
  return "other";
}

function specifiers(source) {
  const result = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
        "ImportExpression",
        "TSImportType",
      ].includes(node.type) &&
      node.source
    )
      result.push(node.source);
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "require"
    )
      result.push(node.arguments[0]);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(source);
  return result;
}

function resolveImport(name, file) {
  if (name.startsWith(".")) {
    const target = resolve(dirname(file), name);
    return [
      target,
      `${target}.ts`,
      `${target}.tsx`,
      resolve(target, "index.ts"),
      resolve(target, "index.tsx"),
    ].find(existsSync);
  }
  try {
    return createRequire(file).resolve(name);
  } catch {
    return undefined;
  }
}

/** Checks actual resolved targets, so relative paths cannot evade package and process boundaries. */
export async function checkBoundaries() {
  const files = [
    ...(await filesIn(resolve(root, "apps/desktop/src"))),
    ...(await filesIn(resolve(root, "packages/ui/src"))),
  ];
  const errors = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const parsed = parseSync(file, text);
    if (parsed.errors.length) {
      errors.push(`${relative(root, file)}: parse failed`);
      continue;
    }
    const source = parsed.program;
    const from = scope(file);
    for (const node of specifiers(source)) {
      const location = `${relative(root, file)}:${text.slice(0, node?.start ?? 0).split("\n").length}`;
      if (!node || typeof node.value !== "string") {
        errors.push(`${location}: non-literal module loading is forbidden`);
        continue;
      }
      const name = node.value;
      const system = name.startsWith("node:") || builtins.has(name);
      const browser = ["renderer", "contracts", "ui", "pure-ui"].includes(from);
      if (
        (browser && (system || name === "electron")) ||
        (from === "desktop/preload" && system) ||
        (["application", "modules", "module-registry", "pure-ui", "contracts"].includes(from) &&
          /^(electron|react|react-dom)(\/|$)/.test(name))
      ) {
        errors.push(`${location}: ${from} cannot import ${name}`);
        continue;
      }
      const resolved = resolveImport(name, file);
      if (!resolved || !isAbsolute(resolved) || resolved.includes(`${sep}node_modules${sep}`))
        continue;
      const target = scope(resolved);
      const allowed = {
        renderer: ["renderer", "contracts", "ui", "pure-ui"],
        contracts: ["contracts", "pure-ui"],
        ui: ["ui", "pure-ui"],
        "pure-ui": ["pure-ui"],
        application: ["application", "contracts", "pure-ui"],
        modules: ["modules", "application", "contracts", "pure-ui"],
        "module-registry": ["modules", "application", "contracts", "pure-ui"],
        "desktop/preload": ["desktop/preload", "contracts", "pure-ui"],
      }[from];
      if (allowed && !allowed.includes(target))
        errors.push(`${location}: ${from} cannot import ${relative(root, resolved)}`);
      if (
        from === "modules" &&
        target === "modules" &&
        dirname(file).split(`${sep}modules${sep}`)[1]?.split(sep)[0] !==
          dirname(resolved).split(`${sep}modules${sep}`)[1]?.split(sep)[0]
      )
        errors.push(`${location}: cross-module imports are forbidden`);
    }
  }
  return { files: files.length, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkBoundaries();
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else console.log(`Dependency boundaries passed (${result.files} source files).`);
}
