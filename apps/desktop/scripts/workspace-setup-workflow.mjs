import assert from "node:assert/strict";
import { readFile, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";

// Native results are controlled; preload, IPC, backend, routing and files remain real.
export async function workspaceSetupWorkflow(application, page, directory) {
	const newPath = join(await realpath(directory), "fresh.txt");
	const existingPath = join(directory, "work.txt");
	const existing = "(A) Bring my own +Work\r\nSecond item";
	await writeFile(existingPath, existing);
	await application.evaluate(
		({ dialog }, paths) => {
			globalThis.setupOriginalDialogs = {
				save: dialog.showSaveDialog,
				open: dialog.showOpenDialog,
			};
			globalThis.setupDialogCanceled = false;
			dialog.showSaveDialog = async (_window, options) => {
				if (options.defaultPath !== "todo.txt") throw Error("Expected suggested todo.txt");
				return { canceled: globalThis.setupDialogCanceled, filePath: paths.newPath };
			};
			dialog.showOpenDialog = async () => ({
				canceled: globalThis.setupDialogCanceled,
				filePaths: [paths.existingPath],
			});
		},
		{ newPath, existingPath }
	);
	const setup = page.getByRole("dialog");
	const newWorkspace = () =>
		page.getByRole("button", { name: "New workspace", exact: true }).click();
	const chooseNew = () =>
		setup.getByRole("button", { name: "Create a Todo file", exact: true }).click();
	const chooseExisting = () =>
		setup.getByRole("button", { name: "Open an existing Todo file", exact: true }).click();
	try {
		await newWorkspace();
		await setup.getByRole("textbox", { name: "Workspace name" }).fill("Fresh start");
		await setup.getByRole("button", { name: "Green", exact: true }).click();
		await chooseNew();
		await setup.getByText(newPath, { exact: true }).waitFor();
		await assert.rejects(readFile(newPath), { code: "ENOENT" });
		await application.evaluate(() => {
			globalThis.setupDialogCanceled = true;
		});
		await chooseNew();
		await chooseExisting();
		assert.equal(
			await setup.getByRole("textbox", { name: "Workspace name" }).inputValue(),
			"Fresh start"
		);
		assert.equal(
			await setup.getByRole("button", { name: "Green", exact: true }).getAttribute("aria-pressed"),
			"true"
		);
		await setup.getByText(newPath, { exact: true }).waitFor();
		await setup.getByRole("button", { name: "Cancel", exact: true }).click();
		await setup.waitFor({ state: "detached" });
		await assert.rejects(readFile(newPath), { code: "ENOENT" });
		await assert.rejects(readFile(join(directory, "workspaces.json")), { code: "ENOENT" });
		assert.equal(await readFile(existingPath, "utf8"), existing);

		await application.evaluate(() => {
			globalThis.setupDialogCanceled = false;
		});
		await newWorkspace();
		await setup.getByRole("textbox", { name: "Workspace name" }).fill("Fresh start");
		await setup.getByRole("button", { name: "Green", exact: true }).click();
		await chooseNew();
		await setup.getByRole("button", { name: "Create workspace", exact: true }).click();
		await setup.waitFor({ state: "detached" });
		const firstItem = page.getByRole("button", { name: "Add your first Todo item", exact: true });
		await firstItem.and(page.locator(":enabled")).waitFor();
		assert.equal(await readFile(newPath, "utf8"), "");
		const catalogue = JSON.parse(await readFile(join(directory, "workspaces.json"), "utf8"));
		const workspace = catalogue.workspaces[0];
		assert.equal(workspace.name, "Fresh start");
		assert.equal(workspace.color, "green");
		assert.equal(catalogue.active_workspace_id, workspace.id);
		await page.waitForURL(`**/workspaces/${workspace.id}`);
		await firstItem.click();
		await setup.getByPlaceholder("What needs doing?").fill("My first real item");
		await setup.getByRole("button", { name: "Clear Creation date" }).click();
		await setup.getByRole("button", { name: "Add Todo item", exact: true }).click();
		await setup.waitFor({ state: "detached" });
		await page
			.getByRole("checkbox", { name: "Mark My first real item complete", exact: true })
			.and(page.locator(":enabled"))
			.waitFor();
		assert.equal(await readFile(newPath, "utf8"), "My first real item");

		await page.getByRole("button", { name: /Select workspace: Fresh start/ }).click();
		await page.getByRole("menuitem", { name: "New workspace", exact: true }).click();
		await setup.getByRole("button", { name: "Create a Todo file", exact: true }).waitFor();
		await setup.getByRole("textbox", { name: "Workspace name" }).fill("Existing work");
		await chooseExisting();
		await setup.getByText(existingPath, { exact: true }).waitFor();
		await setup.getByRole("button", { name: "Create workspace", exact: true }).click();
		await setup.waitFor({ state: "detached" });
		await page
			.getByRole("checkbox", { name: "Mark Bring my own complete", exact: true })
			.and(page.locator(":enabled"))
			.waitFor();
		assert.equal(await readFile(existingPath, "utf8"), existing);
		const saved = JSON.parse(await readFile(join(directory, "workspaces.json"), "utf8"));
		assert.equal(saved.workspaces.length, 2);
		for (const entry of saved.workspaces) {
			const result = await page.evaluate(
				(workspaceId) => window.desktop.deleteWorkspace({ workspaceId }),
				entry.id
			);
			assert.equal(result.status, "applied");
		}
		await page.goto(new URL("/", page.url()).href);
		await page.getByText("No workspace open", { exact: true }).waitFor();
		console.log(
			"Workspace setup: deferred creation, cancellation, first item, non-default existing filename and later setup passed."
		);
	} finally {
		await application.evaluate(({ dialog }) => {
			dialog.showSaveDialog = globalThis.setupOriginalDialogs.save;
			dialog.showOpenDialog = globalThis.setupOriginalDialogs.open;
			delete globalThis.setupOriginalDialogs;
			delete globalThis.setupDialogCanceled;
		});
	}
}
