import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function panelWorkflow(application, page, directory) {
	const session = await page.evaluate(() => window.desktop.readSession({}));
	const previous = session.session.catalogue.workspaces.find(
		(workspace) => workspace.id === session.session.catalogue.active_workspace_id
	);
	const todoPath = join(directory, "panel.todo.txt");
	await writeFile(todoPath, "Panel first +Panel\nPanel second +Panel\nOther item\n");
	const created = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Panel routing",
		color: "cyan",
		todoPath,
	});
	assert.equal(created.status, "applied");
	const id = created.confirmed.session.catalogue.active_workspace_id;
	const destination = new URL(`/workspaces/${id}?other=kept`, page.url()).href;
	await page.goto(destination);
	await application.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].setSize(1400, 900)
	);
	const row = (name) => page.getByRole("button", { name: `Navigate ${name}`, exact: true });
	const panel = page.locator("[data-todo-details]");
	await row("Panel first").and(page.locator(":enabled")).waitFor();
	await page.getByRole("button", { name: "Toggle Todo-item search", exact: true }).click();
	await page.getByRole("searchbox", { name: "Search Todo items" }).fill("Panel");
	const length = await page.evaluate(() => history.length);
	// Keep a DOM reference to prove shallow updates retain the reader.
	const reader = await page.locator("[data-todo-reader]").elementHandle();
	await row("Panel first").click();
	await page.waitForURL(`${destination}&item=1`);
	await panel.getByRole("heading", { name: "Panel first", exact: true }).waitFor();
	await row("Panel second").click();
	await page.waitForURL(`${destination}&item=2`);
	await panel.getByRole("heading", { name: "Panel second", exact: true }).waitFor();
	assert.equal(await page.evaluate(() => history.length), length);
	assert.equal(
		await reader.evaluate((node) => node === document.querySelector("[data-todo-reader]")),
		true
	);
	assert.equal(
		await page.getByRole("searchbox", { name: "Search Todo items" }).inputValue(),
		"Panel"
	);
	await page.getByRole("button", { name: "Close details", exact: true }).click();
	await page.waitForURL(destination);
	await panel.waitFor({ state: "detached" });
	assert.equal(await page.evaluate(() => history.length), length);

	await row("Panel first").click();
	await page.waitForURL(`${destination}&item=1`);
	await page.reload();
	await row("Panel first").and(page.locator(":enabled")).waitFor();
	await page.waitForURL(destination);
	assert.equal(await panel.count(), 0, "Reload cannot trust a physical line alone");
	await page.goto(`${destination}&item=2`);
	await row("Panel first").and(page.locator(":enabled")).waitFor();
	await page.waitForURL(destination);
	assert.equal(await panel.count(), 0, "Direct selection URLs close safely");

	await application.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].setSize(900, 700)
	);
	await row("Panel first").click();
	await page.getByRole("dialog", { name: "Todo item details", exact: true }).waitFor();
	await page.keyboard.press("Escape");
	await page.waitForURL(destination);
	await page
		.getByRole("dialog", { name: "Todo item details", exact: true })
		.waitFor({ state: "detached" });
	await application.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].setSize(1400, 900)
	);

	await application.evaluate(({ ipcMain }) => {
		globalThis.panelCompletion = ipcMain._invokeHandlers.get("tuxedo:set-todo-completion");
		globalThis.panelWriteEntered = new Promise((resolve) => {
			globalThis.enterPanelWrite = resolve;
		});
		ipcMain.removeHandler("tuxedo:set-todo-completion");
		ipcMain.handle("tuxedo:set-todo-completion", async (...args) => {
			globalThis.enterPanelWrite();
			await new Promise((resolve) => {
				globalThis.releasePanelWrite = resolve;
			});
			return globalThis.panelCompletion(...args);
		});
	});
	try {
		await row("Panel first").click();
		await page.waitForURL(`${destination}&item=1`);
		await panel.getByRole("button", { name: "Mark complete", exact: true }).click();
		await application.evaluate(() => globalThis.panelWriteEntered);
		await page.keyboard.press("Escape");
		assert.equal(page.url(), `${destination}&item=1`, "Pending writes block panel dismissal");
		await application.evaluate(() => globalThis.releasePanelWrite());
		await panel
			.getByRole("button", { name: "Mark incomplete", exact: true })
			.and(page.locator(":enabled"))
			.waitFor();
		assert.equal(page.url(), `${destination}&item=1`, "Accepted writes retain selection");
	} finally {
		await application.evaluate(({ ipcMain }) => {
			globalThis.releasePanelWrite?.();
			ipcMain.removeHandler("tuxedo:set-todo-completion");
			ipcMain.handle("tuxedo:set-todo-completion", globalThis.panelCompletion);
			delete globalThis.panelCompletion;
			delete globalThis.panelWriteEntered;
			delete globalThis.enterPanelWrite;
			delete globalThis.releasePanelWrite;
		});
	}

	if (previous) {
		await page.getByRole("button", { name: "Select workspace: Panel routing" }).click();
		await page.getByRole("menuitem", { name: previous.name, exact: true }).click();
		await page.waitForURL(new URL(`/workspaces/${previous.id}`, destination).href);
		await page
			.getByRole("button", { name: `Select workspace: ${previous.name}` })
			.and(page.locator(":enabled"))
			.waitFor();
		await page.goBack();
		await panel.getByRole("heading", { name: "Panel first", exact: true }).waitFor();
		await page.goForward();
		await page.waitForURL(new URL(`/workspaces/${previous.id}`, destination).href);
		await panel.waitFor({ state: "detached" });
		assert.equal(
			await panel.count(),
			0,
			"Forward navigates to the Workspace rather than another selection"
		);
		await writeFile(todoPath, "Replacement on the same physical line\nPanel second +Panel\n");
		await page.goBack();
		await row("Replacement on the same physical line").and(page.locator(":enabled")).waitFor();
		await page.waitForURL(destination);
		await panel.waitFor({ state: "detached" });
		assert.equal(await panel.count(), 0, "History cannot select an externally replaced line");
	}
	console.log(
		"Panel shallow replacements, selection validation, responsive surfaces, admitted writes, and Workspace history passed."
	);
}
