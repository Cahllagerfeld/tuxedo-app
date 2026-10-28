import assert from "node:assert/strict";

export async function kanbanRoutingWorkflow(
	application,
	page,
	routeIds,
	routeUrl,
	activeId,
	expectRoute
) {
	const kanbanUrl = (name) => routeUrl(`/workspaces/${routeIds[name]}/kanban`);
	const expectBoard = async (name, item) => {
		await page.waitForURL(kanbanUrl(name));
		await page.getByRole("heading", { name: "Unassigned", exact: true }).waitFor();
		await page.getByText(item, { exact: true }).waitFor();
		assert.equal(await activeId(), routeIds[name]);
	};

	await page.goto(kanbanUrl("Route A"));
	await expectBoard("Route A", "Alpha item");
	const rail = page.getByRole("navigation", { name: "Workspace navigation" });
	const inset = page.locator('[data-slot="app-inset"]');
	assert.equal(
		await rail.evaluate((node) => !!node.closest('[data-slot="app-inset"]')),
		false,
		"The Workspace rail sits outside the inset"
	);
	const railBox = await rail.boundingBox();
	const insetBox = await inset.boundingBox();
	assert.ok(railBox && insetBox && railBox.x + railBox.width <= insetBox.x);
	const sidebar = page.locator('[data-slot="sidebar"][data-state]');
	const sidebarState = await sidebar.getAttribute("data-state");
	const toggleSidebar = page.getByRole("button", { name: "Toggle Sidebar" });
	if (sidebarState === "collapsed") {
		await toggleSidebar.click();
		await page.waitForFunction(
			() =>
				document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state") ===
				"expanded"
		);
	}
	await toggleSidebar.click();
	await page.waitForFunction(
		() =>
			document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute("data-state") ===
				"collapsed" &&
			document.querySelector('[data-slot="sidebar-gap"]')?.getBoundingClientRect().width === 0
	);
	assert.ok(await rail.isVisible(), "Collapsing the sidebar keeps the Workspace rail visible");
	assert.ok(await page.getByRole("link", { name: "Kanban", exact: true }).isVisible());
	assert.equal((await rail.boundingBox())?.x, railBox.x, "The rail stays in place");
	if (sidebarState === "expanded") await toggleSidebar.click();
	await page.reload();
	await expectBoard("Route A", "Alpha item");
	await page.getByRole("link", { name: "List", exact: true }).click();
	await expectRoute("Route A", "Alpha item");
	await page.goBack();
	await expectBoard("Route A", "Alpha item");
	await page.goForward();
	await expectRoute("Route A", "Alpha item");
	await page.getByRole("button", { name: "Select items", exact: true }).click();
	await page.getByRole("checkbox", { name: "Select Alpha item", exact: true }).click();
	await page.getByText("1 selected", { exact: true }).waitFor();
	await application.evaluate(({ ipcMain }) => {
		const channel = "tuxedo:set-workspace-show-deferred";
		globalThis.heldKanbanPreference = { original: ipcMain._invokeHandlers.get(channel) };
		ipcMain.removeHandler(channel);
		ipcMain.handle(
			channel,
			() => new Promise((resolve) => (globalThis.heldKanbanPreference.release = resolve))
		);
	});
	try {
		const showDeferred = page.getByRole("button", { name: "Show deferred", exact: true });
		await showDeferred.click();
		await showDeferred.and(page.locator(":disabled")).waitFor();
		const pendingUrl = page.url();
		await page.evaluate(
			() =>
				new Promise((resolve) => {
					window.addEventListener("popstate", resolve, { once: true });
					history.back();
				})
		);
		await page.waitForURL(pendingUrl);
		await application.evaluate(() =>
			globalThis.heldKanbanPreference.release({ status: "rejected", message: "Held preference" })
		);
		await page.getByText("Could not save Show deferred", { exact: true }).waitFor();
		await page.getByText("1 selected", { exact: true }).waitFor();
	} finally {
		await application.evaluate(({ ipcMain }) => {
			const channel = "tuxedo:set-workspace-show-deferred";
			ipcMain.removeHandler(channel);
			ipcMain.handle(channel, globalThis.heldKanbanPreference.original);
			delete globalThis.heldKanbanPreference;
		});
	}
	await page.getByRole("link", { name: "Kanban", exact: true }).click();
	await expectBoard("Route A", "Alpha item");
	assert.equal(await page.getByRole("button", { name: "Select items", exact: true }).count(), 0);
	assert.equal(await page.getByText("1 selected", { exact: true }).count(), 0);
	await page.getByRole("link", { name: "List", exact: true }).click();
	await expectRoute("Route A", "Alpha item");
	await page.getByRole("button", { name: "Select items", exact: true }).waitFor();
	assert.equal(await page.getByText("1 selected", { exact: true }).count(), 0);
	await page.getByRole("link", { name: "Kanban", exact: true }).click();
	await expectBoard("Route A", "Alpha item");
	await page.getByRole("button", { name: "Select workspace: Route A" }).click();
	await page.getByRole("menuitem", { name: "Route B", exact: true }).click();
	await expectBoard("Route B", "Beta item");

	await page.getByRole("checkbox", { name: "Mark Beta item complete", exact: true }).click();
	const undo = page.getByRole("button", { name: "Undo completion", exact: true });
	await undo.waitFor();
	await page.getByRole("link", { name: "List", exact: true }).click();
	await expectRoute("Route B", "Beta item");
	assert.ok(await undo.isEnabled(), "Switching views preserves Undo");
	await application.evaluate(({ ipcMain }) => {
		const state = (globalThis.kanbanReadTest = { originals: {}, failRead: true, writes: 0 });
		for (const name of ["read-workspace", "set-todo-completion"]) {
			const channel = `tuxedo:${name}`;
			state.originals[name] = ipcMain._invokeHandlers.get(channel);
			ipcMain.removeHandler(channel);
			ipcMain.handle(channel, (event, input) => {
				if (name === "read-workspace" && state.failRead) {
					state.failRead = false;
					throw Error("Controlled Kanban read unavailable");
				}
				if (name === "set-todo-completion") state.writes++;
				return state.originals[name](event, input);
			});
		}
	});
	try {
		await page.getByRole("link", { name: "Kanban", exact: true }).click();
		await expectBoard("Route B", "Beta item");
		await page.getByText(/Controlled Kanban read unavailable/).waitFor();
		const completion = page.getByRole("checkbox", {
			name: "Mark Beta item incomplete",
			exact: true,
		});
		assert.equal(
			await completion.isEnabled(),
			false,
			"A failed read retains contents but blocks writes"
		);
		await page.getByRole("button", { name: "Retry refresh", exact: true }).click();
		await completion.and(page.locator(":enabled")).waitFor();
		assert.equal(await application.evaluate(() => globalThis.kanbanReadTest.writes), 0);
	} finally {
		await application.evaluate(({ ipcMain }) => {
			for (const [name, handler] of Object.entries(globalThis.kanbanReadTest.originals)) {
				ipcMain.removeHandler(`tuxedo:${name}`);
				ipcMain.handle(`tuxedo:${name}`, handler);
			}
			delete globalThis.kanbanReadTest;
		});
	}
	assert.ok(await undo.isEnabled(), "Returning to the board preserves Undo");
	await undo.click();
	await page.getByRole("checkbox", { name: "Mark Beta item complete", exact: true }).waitFor();

	await page.goto(routeUrl("/workspaces/00000000-0000-4000-8000-000000000000/kanban"));
	await page.waitForURL(routeUrl("/"));
	await page.getByText("Workspace unavailable", { exact: true }).waitFor();
	assert.equal(await activeId(), routeIds["Route B"], "Failed direct navigation keeps the session");
	assert.equal(await page.locator("[data-slot='sidebar']").count(), 0);
	assert.equal(await page.getByRole("navigation", { name: "Workspace navigation" }).count(), 0);
	await page.reload();
	await expectRoute("Route B", "Beta item");
	console.log(
		"Kanban direct navigation, reload, history, Workspace switching, Undo and recovery passed."
	);
}
