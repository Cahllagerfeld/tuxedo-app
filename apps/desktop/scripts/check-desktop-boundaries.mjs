import ts from "typescript";
import { builtinModules } from "node:module";
import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const repository = resolve(desktop, "../..");
const contracts = join(repository, "packages/contracts");
const backend = join(repository, "packages/backend");
const visited = new Set();
const options = {
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	module: ts.ModuleKind.ESNext,
	allowJs: true,
};
const inside = (path, directory) => path.startsWith(directory + sep);

async function check(path, boundary) {
	if (inside(path, contracts)) boundary = "contracts";
	const key = `${boundary}:${path}`;
	if (visited.has(key)) return;
	visited.add(key);
	const content = await readFile(path, "utf8");
	// Svelte scripts use the same module grammar; imports remain parseable in TS mode.
	const code = path.endsWith(".svelte")
		? [...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
				.map((match) => match[1])
				.join("\n")
		: content;
	const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
	const imports = [];
	const visit = (node) => {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		)
			imports.push(node.moduleSpecifier.text);
		if (
			ts.isCallExpression(node) &&
			(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
			node.arguments[0] &&
			ts.isStringLiteral(node.arguments[0])
		)
			imports.push(node.arguments[0].text);
		ts.forEachChild(node, visit);
	};
	visit(source);
	for (const value of imports) {
		const forbidden = () => {
			throw Error(`${path}: forbidden ${boundary} capability import ${value}`);
		};
		if (
			value === "electron" ||
			value.startsWith("electron/") ||
			value.startsWith("@tauri-apps/") ||
			(boundary === "renderer" &&
				(value === "@tuxedo/backend" ||
					value.startsWith("@tuxedo/backend/") ||
					value.startsWith("@effect/platform-node"))) ||
			(boundary !== "backend" && (builtinModules.includes(value) || value.startsWith("node:")))
		)
			forbidden();
		const specifier = value.replace(/^(\$lib\/|@\/)/, join(desktop, "src/lib") + sep);
		const resolved =
			ts.resolveModuleName(specifier, path, options, ts.sys).resolvedModule?.resolvedFileName ??
			(specifier.endsWith(".svelte") ? resolve(dirname(path), specifier) : undefined);
		if (
			boundary === "contracts" &&
			!value.startsWith(".") &&
			!value.startsWith("@tuxedo/contracts") &&
			value !== "effect" &&
			!value.startsWith("effect/") &&
			!(path.endsWith(".spec.ts") && value === "vitest")
		)
			forbidden();
		if (value.startsWith("@tuxedo/") && !resolved) forbidden();
		if (!resolved) continue;
		const target = await realpath(resolved);
		if (!inside(target, repository) || target.includes(`${sep}node_modules${sep}`)) continue;
		if (boundary === "contracts" && !inside(target, contracts)) forbidden();
		if (
			boundary === "renderer" &&
			(inside(target, join(desktop, "electron")) || inside(target, backend))
		)
			forbidden();
		if (boundary === "backend" && !inside(target, backend) && !inside(target, contracts))
			forbidden();
		await check(target, boundary);
	}
}

async function checkTree(directory, boundary) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await checkTree(path, boundary);
		else if (/\.(?:[cm]?[jt]s|svelte)$/.test(path)) await check(path, boundary);
	}
}
await checkTree(join(desktop, "src"), "renderer");
await checkTree(join(backend, "src"), "backend");
await checkTree(join(contracts, "src"), "contracts");
