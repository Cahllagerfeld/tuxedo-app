import { _electron as electron } from "playwright";
import electronPath from "electron";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
const development = process.argv.includes("--dev");
const visible = process.argv.includes("--visible");
const packagedExecutable = process.env.TUXEDO_PACKAGED_EXECUTABLE;
if (development && packagedExecutable) throw Error("Development tests require unpackaged Electron");
const directory = await mkdtemp(join(tmpdir(), "tuxedo-electron-"));
let application;
let vite;
const environment = {
	...process.env,
	TUXEDO_USER_DATA: directory,
	TUXEDO_TEST_HIDDEN: visible ? "0" : "1",
};
if (!packagedExecutable) delete environment.TUXEDO_RENDERER_ORIGIN;
const launchApplication = () =>
	electron.launch({
		timeout: 20000,
		executablePath: packagedExecutable ?? electronPath,
		args: packagedExecutable ? [] : [resolve("dist-electron/main.js")],
		env: environment,
	});
const assertWindowState = async (page) => {
	if (!visible) {
		await page.waitForLoadState("load");
		assert.equal(
			await application.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows()[0].isVisible()
			),
			false,
			"Application window must stay hidden"
		);
		return;
	}
	// The first window can be observed before startup finishes.
	for (let attempt = 0; attempt < 100; attempt++) {
		const state = await application.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows()[0];
			return {
				maximized: window.isMaximized(),
				fullscreen: window.isFullScreen(),
				visible: window.isVisible(),
			};
		});
		assert.equal(state.fullscreen, false, "Application window must keep native fullscreen off");
		if (state.maximized && state.visible) {
			console.log("Application window opens maximized with native fullscreen off.");
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.fail("Application window must open maximized");
};
try {
	if (development) {
		vite = spawn(
			process.execPath,
			["node_modules/vite/bin/vite.js", "--mode", "electron", "--host", "127.0.0.1"],
			{ stdio: "ignore", env: { ...process.env, ELECTRON_STARTUP_PREVENT: "1" } }
		);
		const origin = "http://127.0.0.1:1420";
		for (let attempt = 0; attempt < 100; attempt++) {
			if (vite.exitCode !== null) throw Error("Renderer server exited");
			try {
				if ((await fetch(origin)).ok) break;
			} catch {}
			if (attempt === 99) throw Error("Renderer startup timed out");
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		environment.TUXEDO_RENDERER_ORIGIN = origin;
	}
	application = await launchApplication();
	let page = await application.firstWindow();
	await assertWindowState(page);
	await page.waitForFunction(() => typeof window.desktop?.readSession === "function");
	const confirmed = await page.evaluate(() => window.desktop.readSession({}));
	assert.equal(confirmed.session.status, "empty");
	assert.deepEqual(confirmed.session.catalogue.workspaces, []);
	await application.evaluate(({ dialog }) => {
		globalThis.originalOpenDialog = dialog.showOpenDialog;
		dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
	});
	try {
		assert.equal(await page.evaluate(() => window.desktop.selectTodoFile({})), null);
		await application.evaluate(({ dialog }) => {
			dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ["/tmp/chosen.todo"] });
		});
		assert.equal(await page.evaluate(() => window.desktop.selectTodoFile({})), "/tmp/chosen.todo");
	} finally {
		await application.evaluate(({ dialog }) => {
			dialog.showOpenDialog = globalThis.originalOpenDialog;
			delete globalThis.originalOpenDialog;
		});
	}
	console.log(
		"Todo-file dialog cancellation and selection pass through the admitted desktop bridge."
	);
	assert.equal(await page.evaluate(() => typeof window.require), "undefined");
	assert.equal(await page.evaluate(() => typeof window.process), "undefined");
	assert.equal(
		await page.evaluate(async () => {
			try {
				await window.desktop.readSession({ path: "/etc/passwd" });
				return false;
			} catch {
				return true;
			}
		}),
		true
	);
	await page.getByText("No workspace open", { exact: true }).waitFor();

	// Use Chromium's native theme source without changing the host OS preference.
	await page.emulateMedia({ colorScheme: null });
	const originalThemeSource = await application.evaluate(
		({ nativeTheme }) => nativeTheme.themeSource
	);
	const expectStartupTheme = async (theme) => {
		await application.evaluate(({ nativeTheme }, source) => {
			nativeTheme.themeSource = source;
		}, theme);
		// Stop the SPA and its styles from loading to inspect the initial HTML canvas.
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Network.enable");
		await cdp.send("Network.setBlockedURLs", { urls: ["*.js", "*.css"] });
		try {
			await page.reload({ waitUntil: "domcontentloaded" });
			const initial = await page.evaluate(() => ({
				dark: document.documentElement.classList.contains("dark"),
				scheme: getComputedStyle(document.documentElement).colorScheme,
				background: getComputedStyle(document.documentElement).backgroundColor,
				mounted: document.querySelector("main") !== null,
			}));
			assert.equal(initial.mounted, false, "Startup check must run before the SPA mounts");
			assert.equal(initial.dark, theme === "dark");
			assert.equal(initial.scheme, theme);
			assert.equal(
				initial.background,
				theme === "dark" ? "oklch(0.260325 0 0)" : "oklch(0.949119 0 0)"
			);
			const nativeBackground = await application.evaluate(({ BrowserWindow }) =>
				BrowserWindow.getAllWindows()[0].getBackgroundColor()
			);
			assert.equal(nativeBackground.toLowerCase(), theme === "dark" ? "#242424" : "#eeeeee");
		} finally {
			await cdp.send("Network.setBlockedURLs", { urls: [] });
			await cdp.detach();
		}
		await page.reload();
		await page.getByText("No workspace open", { exact: true }).waitFor();
	};
	const expectTheme = async (theme) => {
		await page.waitForFunction((expected) => {
			const root = document.documentElement;
			return (
				matchMedia("(prefers-color-scheme: dark)").matches === (expected === "dark") &&
				root.classList.contains("dark") === (expected === "dark") &&
				getComputedStyle(root).colorScheme === expected
			);
		}, theme);
	};
	try {
		await expectStartupTheme("dark");
		await expectStartupTheme("light");
		console.log("Dark and light startup backgrounds match before SPA assets load.");
		await application.evaluate(({ nativeTheme }) => {
			nativeTheme.themeSource = "light";
		});
		await expectTheme("light");
		const lightBackground = await page.evaluate(
			() => getComputedStyle(document.body).backgroundColor
		);
		await application.evaluate(({ nativeTheme }) => {
			nativeTheme.themeSource = "dark";
		});
		await expectTheme("dark");
		assert.notEqual(
			await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
			lightBackground
		);
		await page.reload();
		await page.getByText("No workspace open", { exact: true }).waitFor();
		await expectTheme("dark");
		await application.evaluate(({ nativeTheme }) => {
			nativeTheme.themeSource = "light";
		});
		await expectTheme("light");
		assert.equal(
			await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
			lightBackground
		);
		console.log("System theme: light → dark → reload → light passed.");
	} finally {
		await application.evaluate(({ nativeTheme }, source) => {
			nativeTheme.themeSource = source;
		}, originalThemeSource);
	}

	// The inset shell gives the Todo file more room when navigation is collapsed.
	const sidebarToggle = page.getByRole("button", { name: "Toggle Sidebar", exact: true });
	await sidebarToggle.waitFor({ timeout: 5000 });
	const inset = page.locator("[data-slot='app-inset']");
	const content = page.getByRole("main");
	assert.equal(await content.count(), 1, "The page must have one main landmark");
	assert.equal(await content.locator("[data-slot='sidebar']").count(), 0);
	const sidebar = page.locator("[data-slot='sidebar-container']");
	const sidebarBackground = await sidebar
		.locator("[data-slot='sidebar-inner']")
		.evaluate((element) => getComputedStyle(element).backgroundColor);
	const windowBackground = await page
		.locator("[data-slot='sidebar-wrapper']")
		.evaluate((element) => getComputedStyle(element).backgroundColor);
	assert.notEqual(sidebarBackground, windowBackground, "Sidebar must have its own background");
	assert.equal(await inset.locator("[data-slot='sidebar']").count(), 1);
	const insetBounds = await inset.boundingBox();
	const sidebarBounds = await sidebar.boundingBox();
	assert.ok(insetBounds.x > 0, "The full application must have an outer margin");
	assert.ok(sidebarBounds.x >= insetBounds.x, "Sidebar must sit inside the inset");
	assert.ok(sidebarBounds.y >= insetBounds.y, "Sidebar must sit below the inset's top edge");
	assert.ok(
		sidebarBounds.y + sidebarBounds.height <= insetBounds.y + insetBounds.height,
		"Sidebar must fit inside the inset's bottom edge"
	);
	const expandedWidth = (await content.boundingBox()).width;
	await sidebarToggle.click();
	await page.waitForFunction(
		(width) =>
			document.querySelector("[data-slot='app-content']").getBoundingClientRect().width >
			width + 100,
		expandedWidth
	);
	assert.deepEqual(
		await inset.boundingBox(),
		insetBounds,
		"Collapsing keeps the outer inset fixed"
	);
	await page.getByText("No workspace open", { exact: true }).waitFor();
	// Collapsed navigation must not leave keyboard focus on offscreen controls.
	await sidebarToggle.focus();
	await page.keyboard.press("Shift+Tab");
	const focusedLeft = await page.evaluate(
		() => document.activeElement.getBoundingClientRect().left
	);
	assert.ok(focusedLeft >= 0, "Collapsed sidebar navigation must be excluded from keyboard focus");
	await sidebarToggle.click();
	await page.waitForFunction(
		(width) =>
			Math.abs(
				document.querySelector("[data-slot='app-content']").getBoundingClientRect().width - width
			) < 2,
		expandedWidth
	);
	const windowSize = await application.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows()[0];
		const size = window.getContentSize();
		window.setContentSize(600, 700);
		return size;
	});
	await page.waitForFunction(() => matchMedia("(max-width: 767px)").matches);
	await sidebarToggle.click();
	await page.getByRole("dialog").waitFor();
	await page.waitForFunction(() => {
		const bounds = document.querySelector("[data-mobile='true']").getBoundingClientRect();
		return bounds.x >= 0 && bounds.y >= 0 && bounds.bottom <= innerHeight;
	});
	await page.keyboard.press("Escape");
	await page.getByRole("dialog").waitFor({ state: "hidden" });
	await application.evaluate(({ BrowserWindow }, size) => {
		BrowserWindow.getAllWindows()[0].setContentSize(...size);
	}, windowSize);
	await sidebar.waitFor({ state: "visible" });

	const preferences = await application.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
	);
	assert.equal(preferences.sandbox, true);
	assert.equal(preferences.contextIsolation, true);
	assert.equal(preferences.nodeIntegration, false);
	await assert.rejects(readFile(join(directory, "workspaces.json")), { code: "ENOENT" });
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, "(A) Call Mom +Family @phone\nx 2026-07-10 Finished\n");
	const created = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Personal",
		color: "green",
		todoPath,
	});
	assert.equal(created.status, "applied");
	assert.equal(created.confirmed.session.status, "ready");
	assert.equal(created.confirmed.session.todo_file.items.length, 2);
	assert.equal(created.confirmed.session.todo_file.items[0].description, "Call Mom");
	assert.deepEqual(
		(await page.evaluate(() => window.desktop.readSession({}))).session,
		created.confirmed.session
	);
	const createdTodo = await page.evaluate((input) => window.desktop.createTodo(input), {
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		description: "Plan sprint",
		projects: ["Planning"],
		contexts: ["desk"],
		priority: "Z",
		creationDate: "2026-10-01",
		completed: true,
		completionDate: "2026-10-09",
		metadata: ["due:2026-10-10", "custom:value"],
	});
	assert.equal(createdTodo.status, "applied");
	assert.equal(createdTodo.confirmed.todo_file.items.at(-1).description, "Plan sprint");
	assert.deepEqual(createdTodo.confirmed.todo_file.items.at(-1).projects, ["Planning"]);
	assert.deepEqual(createdTodo.confirmed.todo_file.items.at(-1).contexts, ["desk"]);
	assert.match(
		await readFile(todoPath, "utf8"),
		/\nx 2026-10-09 2026-10-01 Plan sprint \+Planning @desk due:2026-10-10 custom:value pri:Z\n$/
	);
	assert.equal(createdTodo.confirmed.todo_file.items.at(-1).completed, true);
	assert.equal(createdTodo.confirmed.todo_file.items.at(-1).creation_date, "2026-10-01");
	assert.equal(createdTodo.confirmed.todo_file.items.at(-1).completion_date, "2026-10-09");
	assert.deepEqual(createdTodo.confirmed.todo_file.items.at(-1).metadata, {
		due: "2026-10-10",
		custom: "value",
		pri: "Z",
	});

	const invalidCreationRejected = await page.evaluate(async (confirmed) => {
		try {
			await window.desktop.createTodo({
				scope: confirmed.scope,
				revision: confirmed.revision,
				workspaceId: confirmed.workspaceId,
				description: "Invalid",
				projects: [],
				contexts: [],
				completed: true,
				completionDate: "2026-02-30",
				unexpected: true,
			});
			return false;
		} catch {
			return true;
		}
	}, createdTodo.confirmed);
	assert.equal(invalidCreationRejected, true);
	assert.equal(
		(await page.evaluate(() => window.desktop.readSession({}))).revision,
		createdTodo.confirmed.revision
	);

	const rejected = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Personal",
		color: "green",
		todoPath,
	});
	assert.equal(rejected.status, "rejected");
	assert.equal(
		await page.evaluate(async () => {
			try {
				await window.desktop.createWorkspace({
					name: "Bad",
					color: "invalid",
					todoPath: "/tmp/invalid",
				});
				return false;
			} catch {
				return true;
			}
		}),
		true
	);
	const secondPath = join(directory, "second.todo");
	await writeFile(secondPath, "Second item");
	await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Second",
		color: "blue",
		todoPath: secondPath,
	});
	const switched = await page.evaluate(
		(workspaceId) => window.desktop.switchWorkspace({ workspaceId }),
		created.confirmed.session.catalogue.active_workspace_id
	);
	assert.equal(switched.status, "applied");
	assert.equal(switched.confirmed.session.todo_file.items[0].description, "Call Mom");

	const completionTarget = {
		scope: switched.confirmed.scope,
		revision: switched.confirmed.revision,
		workspaceId: switched.confirmed.session.catalogue.active_workspace_id,
		lineNumber: 1,
		expectedRaw: switched.confirmed.session.todo_file.items[0].raw,
		completed: true,
	};
	const completed = await page.evaluate(
		(input) => window.desktop.setTodoCompletion(input),
		completionTarget
	);
	assert.equal(completed.status, "applied");
	assert.equal(completed.confirmed.todo_file.items[0].completed, true);
	assert.match(
		await readFile(todoPath, "utf8"),
		/^x \d{4}-\d{2}-\d{2} Call Mom \+Family @phone pri:A\n/
	);
	const uncompleted = await page.evaluate((input) => window.desktop.setTodoCompletion(input), {
		...completionTarget,
		revision: completed.confirmed.revision,
		expectedRaw: completed.confirmed.todo_file.items[0].raw,
		completed: false,
	});
	assert.equal(uncompleted.status, "applied");
	assert.equal(uncompleted.confirmed.todo_file.items[0].raw, "(A) Call Mom +Family @phone");
	await writeFile(todoPath, "Externally changed\nx 2026-07-10 Finished\n");
	const conflict = await page.evaluate((input) => window.desktop.setTodoCompletion(input), {
		...completionTarget,
		revision: uncompleted.confirmed.revision,
	});
	assert.equal(conflict.status, "conflict");
	assert.equal(conflict.confirmed.todo_file.items[0].raw, "Externally changed");
	await writeFile(todoPath, "(A) Call Mom +Family @phone\nx 2026-07-10 Finished\n");
	await page.evaluate(() => window.desktop.restoreSession({}));
	const missing = await page.evaluate(() =>
		window.desktop.switchWorkspace({ workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
	);
	assert.equal(missing.status, "rejected");
	await page.reload();
	await page.getByText("Call Mom", { exact: true }).waitFor();
	await application.close();
	application = await launchApplication();
	page = await application.firstWindow();
	await assertWindowState(page);
	await page.getByText("Call Mom", { exact: true }).waitFor();
	const restored = await page.evaluate(() => window.desktop.readSession({}));
	assert.equal(
		restored.session.catalogue.active_workspace_id,
		created.confirmed.session.catalogue.active_workspace_id
	);
	assert.deepEqual(
		restored.session.catalogue.workspaces.map((workspace) => workspace.name),
		["Personal", "Second"]
	);
	// Real observation signals cross preload/IPC and use the mounted controller.
	await writeFile(
		todoPath,
		"(B) External insertion +Observed @desk\nx 2026-10-10 Finished\n2026-13-01 Invalid\n"
	);
	await page.getByText("External insertion", { exact: true }).waitFor();
	await page.getByText("Todo file reloaded", { exact: true }).waitFor();
	assert.equal(await page.locator('[data-sonner-toast][data-type="info"]').count(), 1);
	assert.equal(await page.locator('[data-sonner-toast][data-type="error"]').count(), 0);
	assert.match(await page.getByLabel("Reader status").textContent(), /1 skipped line/);
	await page.getByRole("button", { name: /^All\s*2$/ }).waitFor();
	await page.getByRole("button", { name: /^Open\s*1$/ }).waitFor();
	await page.getByRole("button", { name: /^Completed\s*1$/ }).waitFor();
	assert.match(
		await page.getByRole("button", { name: "+Observed", exact: true }).textContent(),
		/1/
	);
	assert.match(await page.getByRole("button", { name: "@desk", exact: true }).textContent(), /1/);
	await page.getByRole("button", { name: "Priority B", exact: true }).waitFor();
	const observed = await page.evaluate(() => window.desktop.readSession({}));
	assert.deepEqual(observed.session.todo_file.items[0].projects, ["Observed"]);
	await writeFile(
		todoPath,
		"(B) External insertion +Observed @desk\nx 2026-10-10 Finished\n2026-13-01 Invalid\n\n"
	);
	await page.waitForFunction(
		async (revision) => (await window.desktop.readSession({})).revision > revision,
		observed.revision
	);
	assert.equal(
		await page.locator('[data-sonner-toast][data-type="info"]').count(),
		1,
		"Equivalent save must not add a notice"
	);
	await writeFile(todoPath, "(A) Call Mom +Family @phone\nx 2026-07-10 Finished\n");
	await page.getByText("Call Mom", { exact: true }).waitFor();
	console.log(
		"Todo-file observation: external edit, items, counts, facets, skipped lines, preload signal, and equivalent-save notice checks passed."
	);
	const deleted = await page.evaluate(
		(workspaceId) => window.desktop.deleteWorkspace({ workspaceId }),
		created.confirmed.session.catalogue.active_workspace_id
	);
	assert.equal(deleted.status, "applied");
	assert.equal(deleted.confirmed.session.status, "empty");
	assert.equal(deleted.confirmed.session.catalogue.active_workspace_id, null);
	assert.equal(deleted.confirmed.session.catalogue.workspaces.length, 1);
	assert.equal(deleted.confirmed.session.catalogue.workspaces[0].name, "Second");
	assert.equal(
		await readFile(todoPath, "utf8"),
		"(A) Call Mom +Family @phone\nx 2026-07-10 Finished\n"
	);
	assert.deepEqual(
		JSON.parse(await readFile(join(directory, "workspaces.json"), "utf8")).workspaces.map(
			(workspace) => workspace.name
		),
		["Second"]
	);
	// Reorder through the real renderer/preload/backend, including a filtered-out item.
	const reorderPath = join(directory, "reorder.todo");
	await writeFile(reorderPath, "First\r\nx 2026-07-10 Hidden\r\nLast");
	const reorderWorkspace = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Reorder",
		color: "blue",
		todoPath: reorderPath,
	});
	assert.equal(reorderWorkspace.status, "applied");
	await page.reload();
	assert.equal(
		await page.getByRole("button", { name: /^All/ }).getAttribute("aria-pressed"),
		"true"
	);
	await page.getByRole("button", { name: /^Open/ }).click();
	const firstHandle = page.getByRole("button", { name: "Reorder First", exact: true });
	await firstHandle.waitFor();
	await firstHandle.focus();
	await page.keyboard.press("Space");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Space");
	await page.waitForFunction(
		() => document.querySelector('ul[aria-label="Todo items"] li p')?.textContent === "Last"
	);
	assert.equal(await readFile(reorderPath, "utf8"), "Last\r\nx 2026-07-10 Hidden\r\nFirst");
	await page.reload();
	await page.getByRole("button", { name: /^Open/ }).click();
	const lastHandle = page.getByRole("button", { name: "Reorder Last", exact: true });
	await lastHandle.waitFor();
	const from = await lastHandle.boundingBox();
	const to = await page.getByRole("button", { name: "Reorder First", exact: true }).boundingBox();
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
	await page.mouse.up();

	await page.waitForFunction(
		() => document.querySelector('ul[aria-label="Todo items"] li p')?.textContent === "First"
	);
	assert.equal(await readFile(reorderPath, "utf8"), "First\r\nx 2026-07-10 Hidden\r\nLast");
	const manyItems = Array.from({ length: 100 }, (_, index) => `Item ${index + 1}`);
	await writeFile(reorderPath, manyItems.join("\n"));
	// Wait for observation to accept the external edit before starting the drag.
	await page.getByRole("button", { name: "Reorder Item 1", exact: true }).waitFor();
	await page.reload();
	await page.getByRole("button", { name: "Reorder Item 1", exact: true }).waitFor();
	await page.getByRole("list", { name: "Todo items" }).evaluate((list) => {
		const viewport = list.closest('[data-slot="scroll-area-viewport"]');
		viewport.scrollTop = 41 * 40;
	});
	const middleHandle = page.getByRole("button", { name: "Reorder Item 45", exact: true });
	await middleHandle.waitFor({ state: "visible" });
	const initialRenderedCount = await page
		.getByRole("list", { name: "Todo items" })
		.locator("li")
		.count();
	assert.equal(await page.getByRole("button", { name: "Reorder Item 1", exact: true }).count(), 0);
	const middleFrom = await middleHandle.boundingBox();
	const middleTo = await page
		.getByRole("button", { name: "Reorder Item 47", exact: true })
		.boundingBox();
	await page.mouse.move(middleFrom.x + middleFrom.width / 2, middleFrom.y + middleFrom.height / 2);
	await page.mouse.down();
	await page.mouse.move(middleTo.x + middleTo.width / 2, middleTo.y + middleTo.height / 2, {
		steps: 12,
	});
	const expectedItems = [...manyItems];
	expectedItems.splice(44, 1);
	expectedItems.splice(46, 0, manyItems[44]);
	await page.waitForFunction(
		() => {
			return (
				document.querySelector('ul[aria-label="Todo items"] li[aria-posinset="47"] p')
					?.textContent === "Item 45"
			);
		},
		undefined,
		{ timeout: 10000 }
	);
	await page.mouse.up();

	await page.waitForFunction(
		(limit) => document.querySelectorAll('ul[aria-label="Todo items"] li').length <= limit,
		initialRenderedCount + 3,
		{ timeout: 10000 }
	);
	await page.getByRole("list", { name: "Todo items" }).evaluate((list) => {
		list.closest('[data-slot="scroll-area-viewport"]').scrollTop = 41 * 40;
	});
	await page.waitForFunction(
		() =>
			document.querySelector('ul[aria-label="Todo items"] li[aria-posinset="47"] p')
				?.textContent === "Item 45",
		undefined,
		{ timeout: 10000 }
	);
	assert.equal(await readFile(reorderPath, "utf8"), expectedItems.join("\n"));
	console.log("Pointer reorder from a virtualized middle row preserves all Todo items.");
	await page.evaluate(
		(workspaceId) => window.desktop.deleteWorkspace({ workspaceId }),
		reorderWorkspace.confirmed.session.catalogue.active_workspace_id
	);
	console.log(
		"Keyboard and pointer reorder persist across reload and preserve filtered-out Todo items."
	);
	const deletionPath = join(directory, "deletion.todo");
	await writeFile(deletionPath, "First +Work\r\nx 2026-07-10 Finished +Home");
	const deletionWorkspace = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Deletion",
		color: "blue",
		todoPath: deletionPath,
	});
	assert.equal(deletionWorkspace.status, "applied");
	const deletionTarget = {
		scope: deletionWorkspace.confirmed.scope,
		revision: deletionWorkspace.confirmed.revision,
		workspaceId: deletionWorkspace.confirmed.session.catalogue.active_workspace_id,
		lineNumber: 2,
		expectedRaw: "x 2026-07-10 Finished +Home",
	};
	const itemDeleted = await page.evaluate(
		(input) => window.desktop.deleteTodo(input),
		deletionTarget
	);
	assert.equal(itemDeleted.status, "applied");
	assert.equal(itemDeleted.confirmed.workspaceId, deletionTarget.workspaceId);
	assert.deepEqual(
		itemDeleted.confirmed.todo_file.items.map((item) => item.description),
		["First"]
	);
	assert.equal(await readFile(deletionPath, "utf8"), "First +Work\r\n");
	await writeFile(deletionPath, "Changed externally\r\n");
	const deletionConflict = await page.evaluate((input) => window.desktop.deleteTodo(input), {
		...deletionTarget,
		revision: itemDeleted.confirmed.revision,
		lineNumber: 1,
		expectedRaw: "First +Work",
	});
	assert.equal(deletionConflict.status, "conflict");
	assert.equal(deletionConflict.confirmed.todo_file.items[0].description, "Changed externally");
	assert.equal(await readFile(deletionPath, "utf8"), "Changed externally\r\n");

	// Exercise appearance with enough real Todo items to overflow the reader.
	await writeFile(
		deletionPath,
		Array.from({ length: 1000 }, (_, index) => `Item ${index + 1}`).join("\n")
	);
	await page.reload();
	await page.getByText("Item 1", { exact: true }).waitFor();
	const renderedItems = page.getByRole("list", { name: "Todo items" }).getByRole("listitem");
	assert.ok((await renderedItems.count()) < 60, "Todo-item rendering must stay bounded");
	assert.equal(await page.getByText("Item 1000", { exact: true }).count(), 0);
	const switcher = page.getByRole("button", { name: "Select workspace: Deletion" });
	// Check settled hover colors without a timed wait that can outlive native hover.
	await switcher.evaluate((element) => {
		element.style.transition = "none";
	});
	await switcher.hover();
	const hoverContrast = await switcher.evaluate((element) => {
		const background = getComputedStyle(element).backgroundColor;
		const sidebar = getComputedStyle(
			element.closest('[data-slot="sidebar-inner"]')
		).backgroundColor;
		return background !== "rgba(0, 0, 0, 0)" && background !== sidebar;
	});
	await switcher.evaluate((element) => element.style.removeProperty("transition"));
	const reader = page.getByLabel("Todo item results", { exact: true });
	await reader.hover();
	const thumb = reader.locator('[data-slot="scroll-area-thumb"]');
	await thumb.waitFor({ state: "visible" });
	const thumbVisible = await thumb.isVisible();
	assert.ok(
		hoverContrast && thumbVisible,
		`Workspace hover contrast: ${hoverContrast}; ScrollArea thumb visible: ${thumbVisible}`
	);
	const viewport = reader.locator('[data-slot="scroll-area-viewport"]');
	await viewport.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await page.waitForFunction(
		() =>
			document.querySelector('[aria-label="Todo item results"] [data-slot="scroll-area-viewport"]')
				.scrollTop > 0
	);
	await page.getByText("Item 1000", { exact: true }).waitFor();
	assert.ok(await page.getByText("Item 1000", { exact: true }).isVisible());
	assert.ok((await renderedItems.count()) < 60, "Scrolling must keep Todo-item rendering bounded");

	const mod = process.platform === "darwin" ? "Meta" : "Control";
	const todoSearch = page.getByRole("searchbox", { name: "Search Todo items" });
	assert.equal(await todoSearch.count(), 0, "Search is collapsed initially");
	await page.keyboard.press(`${mod}+/`);
	const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
	await help.waitFor();
	assert.ok((await help.textContent()).includes(process.platform === "darwin" ? "⌘" : "Ctrl"));
	await page.keyboard.press(`${mod}+f`);
	assert.ok(
		await help.evaluate((element) => element.contains(document.activeElement)),
		"Help suspends the search shortcut"
	);
	await page.keyboard.press(`${mod}+b`);
	assert.equal(
		await page.locator('[data-slot="sidebar"]').getAttribute("data-state"),
		"expanded",
		"Help suspends sidebar shortcuts"
	);
	await page.keyboard.press("Escape");
	await help.waitFor({ state: "detached" });
	await page.getByRole("searchbox", { name: "Find a filter" }).focus();
	await page.keyboard.press(`${mod}+f`);
	assert.equal(
		await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
		"Search Todo items",
		"Find shortcut focuses Todo-item search even from another input"
	);
	await todoSearch.fill("Item 1000");
	await page.keyboard.press(`${mod}+f`);
	assert.equal(await todoSearch.count(), 0, "Find shortcut closes search");
	await page.keyboard.press(`${mod}+f`);
	assert.equal(await todoSearch.inputValue(), "", "Closing search clears its query");
	assert.ok(await todoSearch.evaluate((element) => element === document.activeElement));
	await page.keyboard.press(`${mod}+p`);
	await page.getByRole("menu").waitFor();
	await page.keyboard.press(`${mod}+n`);
	assert.equal(await page.getByRole("dialog").count(), 0, "Workspace menu suspends creation");
	await page.keyboard.press("Escape");
	await page.getByRole("menu").waitFor({ state: "detached" });
	await page.keyboard.press(`${mod}+Shift+n`);
	await page.getByRole("dialog", { name: "Create workspace" }).waitFor();
	await page.keyboard.press("Escape");
	await page.getByRole("dialog").waitFor({ state: "detached" });
	await page.keyboard.press(`${mod}+n`);
	await page.getByRole("dialog", { name: "New Todo item" }).waitFor();
	await page.keyboard.press("Escape");
	await page.getByRole("dialog").waitFor({ state: "detached" });
	const rowNavigation = page.getByRole("button", { name: "Navigate Item 1000", exact: true });
	await viewport.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await rowNavigation.waitFor();
	await rowNavigation.focus();
	await page.keyboard.press("Home");
	await page.getByRole("button", { name: "Navigate Item 1", exact: true }).waitFor();
	assert.equal(
		await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
		"Navigate Item 1"
	);
	await page.keyboard.press("End");
	await rowNavigation.waitFor();
	assert.equal(
		await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
		"Navigate Item 1000"
	);
	await page.keyboard.press("Enter");
	await page.getByRole("heading", { name: "Item 1000", exact: true }).waitFor();
	assert.equal(await page.locator("[data-todo-details] code").textContent(), "Item 1000");
	await application.evaluate(async ({ clipboard, ClipboardItem }) => {
		globalThis.clipboardBeforeCopyTest = await Promise.all(
			(await clipboard.read()).map(
				async (item) =>
					new ClipboardItem(
						Object.fromEntries(
							await Promise.all(item.types.map(async (type) => [type, await item.getType(type)]))
						)
					)
			)
		);
	});
	try {
		assert.equal(
			await page.evaluate(async () => {
				try {
					await navigator.clipboard.writeText("browser clipboard probe");
					return "allowed";
				} catch (error) {
					return error.name;
				}
			}),
			"NotAllowedError"
		);
		await page.getByRole("button", { name: "Copy raw line", exact: true }).click();
		await page
			.getByRole("status")
			.filter({ hasText: "Raw line copied" })
			.waitFor({ timeout: 5000 });
		assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), "Item 1000");
		const exactText = "  (A) Café\t+Launch  @home\u00a0due:2026-10-14  ";
		await page.evaluate((text) => window.desktop.writeClipboardText({ text }), exactText);
		assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), exactText);
	} finally {
		await application.evaluate(async ({ clipboard }) => {
			await clipboard.write(globalThis.clipboardBeforeCopyTest);
			delete globalThis.clipboardBeforeCopyTest;
		});
	}
	await page.keyboard.press("Escape");
	await page.locator("[data-todo-details]").waitFor({ state: "detached" });
	assert.equal(
		await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
		"Navigate Item 1000"
	);
	await page.keyboard.press("e");
	await page.getByRole("dialog", { name: "Edit Todo item" }).waitFor();
	await page.keyboard.press("Escape");
	await page.getByRole("dialog").waitFor({ state: "detached" });
	assert.equal(
		await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
		"Navigate Item 1000"
	);
	await page.getByRole("button", { name: "Add Todo item", exact: true }).focus();
	await viewport.evaluate((element) => {
		element.scrollTop = 0;
	});
	await page.getByText("Item 1", { exact: true }).waitFor();
	await page.waitForFunction(() => !document.querySelector('[aria-label="Navigate Item 1000"]'));
	await page.keyboard.press("Tab");
	assert.equal(
		await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
		"Search Todo items",
		"Tab must reach search before the Todo-item list"
	);
	await page.keyboard.press("Tab");
	assert.equal(
		await page.evaluate(() => document.activeElement.getAttribute("aria-label")),
		"Todo items",
		"Tab must reenter row navigation after scrolling away from the old row"
	);
	await page.keyboard.press("End");
	await rowNavigation.waitFor();
	console.log(
		"Desktop shortcut help, platform hints, popup suppression, creation, virtualized row navigation and editor return focus passed."
	);

	const addTodo = page.getByRole("button", { name: "Add Todo item", exact: true });
	await addTodo.click();
	const creationDialog = page.getByRole("dialog");
	await creationDialog.getByPlaceholder("What needs doing?").fill("Metadata check");
	await creationDialog.getByRole("button", { name: "Other", exact: true }).click();
	await creationDialog.getByRole("textbox", { name: "Other priority" }).fill("z");
	await creationDialog.getByRole("button", { name: "Clear Creation date" }).click();
	const metadataInput = creationDialog.getByPlaceholder("Add key:value");
	await metadataInput.fill("custom:first");
	await metadataInput.press("Enter");
	await metadataInput.fill("due:2026-10-12");
	await creationDialog.getByRole("button", { name: "Add Todo item", exact: true }).click();
	await creationDialog.waitFor({ state: "detached" });
	assert.ok(
		(await readFile(deletionPath, "utf8")).endsWith(
			"\n(Z) Metadata check custom:first due:2026-10-12"
		)
	);
	await page.reload();
	await addTodo.waitFor();
	const metadataSession = await page.evaluate(() => window.desktop.readSession({}));
	assert.equal(metadataSession.session.status, "ready");
	assert.equal(metadataSession.session.todo_file.items.at(-1).priority, "Z");
	assert.deepEqual(metadataSession.session.todo_file.items.at(-1).metadata, {
		custom: "first",
		due: "2026-10-12",
	});
	await viewport.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	const editMenu = page.getByRole("button", { name: "Actions for Metadata check", exact: true });
	await editMenu.click();
	await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
	const editDialog = page.getByRole("dialog");
	assert.equal(
		await editDialog.getByPlaceholder("What needs doing?").inputValue(),
		"Metadata check"
	);
	await editDialog.getByPlaceholder("What needs doing?").fill("Edited metadata check");
	await editDialog.getByRole("button", { name: "Save changes", exact: true }).click();
	await editDialog.waitFor({ state: "detached" });
	assert.ok(
		(await readFile(deletionPath, "utf8")).endsWith(
			"\n(Z) Edited metadata check custom:first due:2026-10-12"
		)
	);
	await page.reload();
	await viewport.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await page.getByText("Edited metadata check", { exact: true }).waitFor();
	console.log(
		"Todo-item editing through the row menu, form, preload and backend persists across reload."
	);
	console.log("Metadata entered through the form persists in the Todo file and after reload.");
	// Exercise the sandboxed preload's response and event validators with main-supplied data.
	await application.evaluate(({ ipcMain }) => {
		ipcMain.removeHandler("tuxedo:select-todo-file");
		ipcMain.handle("tuxedo:select-todo-file", () => ({ path: "/tmp/unexpected" }));
	});
	assert.equal(
		await page.evaluate(async () => {
			try {
				await window.desktop.selectTodoFile({});
				return false;
			} catch {
				return true;
			}
		}),
		true
	);
	const signal = {
		scope: "9426bd98-a6dd-48eb-b1ab-037d82983ae1",
		revision: 0,
		workspaceId: "550e8400-e29b-41d4-a716-446655440000",
		todoPath: "/tmp/validation.todo",
	};
	await page.evaluate(() => {
		window.validationSignals = [];
		window.validationSignalReceived = new Promise((resolve) => {
			const unsubscribe = window.desktop.onTodoFileChanged((event) => {
				window.validationSignals.push(event);
				if (event.todoPath === "/tmp/validation.todo") {
					unsubscribe();
					resolve();
				}
			});
		});
	});
	await application.evaluate(({ BrowserWindow }, valid) => {
		const contents = BrowserWindow.getAllWindows()[0].webContents;
		for (const invalid of [
			null,
			{ ...valid, revision: -1 },
			{ ...valid, scope: "invalid" },
			{ ...valid, unexpected: true },
		])
			contents.send("tuxedo:todo-file-changed", invalid);
		contents.send("tuxedo:todo-file-changed", valid);
	}, signal);
	assert.deepEqual(
		await page.evaluate(async () => {
			await window.validationSignalReceived;
			return window.validationSignals;
		}),
		[signal]
	);
	console.log(
		"Sandboxed preload rejects malformed responses and discards malformed observation events."
	);
	console.log(
		"Real Electron preload/IPC lifecycle, completion, deletion, conflicts, and isolation checks passed."
	);
	const exited = once(application.process(), "exit", { signal: AbortSignal.timeout(15000) });
	await application.evaluate(({ app }) => {
		app.quit();
	});
	assert.equal((await exited)[0], 0, "Normal quit must complete cleanup and exit successfully");
	application = undefined;
	console.log("Real Electron normal quit drained and exited successfully.");
	application = await launchApplication();
	const stuckPage = await application.firstWindow();
	await stuckPage.waitForFunction(() => typeof window.desktop?.selectTodoFile === "function");
	await application.evaluate(({ dialog }) => {
		globalThis.dialogEntered = false;
		dialog.showOpenDialog = () => {
			globalThis.dialogEntered = true;
			return new Promise(() => {});
		};
	});
	await stuckPage.evaluate(() => {
		void window.desktop.selectTodoFile({}).catch(() => {});
	});
	await application.evaluate(async () => {
		while (!globalThis.dialogEntered) await new Promise((resolve) => setTimeout(resolve, 10));
	});
	let shutdownDiagnostic = "";
	application.process().stderr.setEncoding("utf8");
	application.process().stderr.on("data", (chunk) => {
		shutdownDiagnostic += chunk;
	});
	const forcedExit = once(application.process(), "exit", { signal: AbortSignal.timeout(15000) });
	await application.evaluate(({ app }) => {
		app.quit();
		app.quit();
	});
	assert.equal((await forcedExit)[0], 1, "A stuck dialog must reach the bounded quit fallback");
	assert.match(shutdownDiagnostic, /Application shutdown deadline exceeded/);
	assert.match(shutdownDiagnostic, /selectTodoFile/);
	application = undefined;
	console.log(
		"Real Electron stuck-dialog quit reached the 10-second fallback with pending-operation diagnostics."
	);
	if (!packagedExecutable) {
		const failed = spawn(electronPath, [resolve("dist-electron/main.js")], {
			env: { ...environment, TUXEDO_RENDERER_ORIGIN: "http://127.0.0.1:1" },
			stdio: ["ignore", "ignore", "pipe"],
		});
		let diagnostic = "";
		failed.stderr.setEncoding("utf8");
		failed.stderr.on("data", (chunk) => {
			diagnostic += chunk;
		});
		try {
			const [code] = await once(failed, "exit", { signal: AbortSignal.timeout(15000) });
			assert.equal(code, 1, diagnostic);
			assert.match(diagnostic, /Desktop startup failed/);
			assert.doesNotMatch(diagnostic, /shutdown deadline exceeded/);
		} finally {
			if (failed.exitCode === null && failed.signalCode === null) failed.kill();
		}
		console.log("Real Electron renderer startup failure cleaned up and exited with a diagnostic.");
	}
} finally {
	try {
		await application?.close();
	} finally {
		try {
			if (vite && vite.exitCode === null && vite.signalCode === null) {
				const exited = once(vite, "exit", { signal: AbortSignal.timeout(5000) });
				vite.kill();
				await exited;
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
}
