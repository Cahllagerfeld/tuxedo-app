import ts from "typescript";
import { builtinModules } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
async function check(directory, renderer = true) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			await check(path, renderer);
			continue;
		}
		if (!/\.(ts|svelte)$/.test(path)) continue;
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
				node.expression.kind === ts.SyntaxKind.ImportKeyword &&
				ts.isStringLiteral(node.arguments[0])
			)
				imports.push(node.arguments[0].text);
			ts.forEachChild(node, visit);
		};
		visit(source);
		for (const value of imports)
			if (
				(renderer && builtinModules.includes(value)) ||
				value === "electron" ||
				value.startsWith("@tauri-apps/") ||
				(renderer && value.startsWith("node:")) ||
				(renderer && value.includes("/electron/")) ||
				(renderer && /(^|\/)backend\//.test(value))
			)
				throw Error(`${path}: forbidden desktop capability import ${value}`);
	}
}
await check("src");

await check("electron/backend", false);
