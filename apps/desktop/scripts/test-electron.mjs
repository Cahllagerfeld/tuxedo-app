import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import electronPath from "electron";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
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
	// Loading the entry route resumes the backend's Active workspace, like a fresh launch.
	const reopen = () => page.goto(new URL("/", page.url()).href);
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
	assert.equal(
		await page.locator("[data-slot='sidebar']").count(),
		0,
		"Home must not render workspace filters"
	);

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
		await reopen();
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
		await reopen();
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

	const preferences = await application.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
	);
	assert.equal(preferences.sandbox, true);
	assert.equal(preferences.contextIsolation, true);
	assert.equal(preferences.nodeIntegration, false);
	await assert.rejects(readFile(join(directory, "workspaces.json")), { code: "ENOENT" });
	const todoPath = join(directory, "todo.txt");
	await writeFile(todoPath, "(A) Call Mom +Family @phone\nx 2026-07-10 Finished\n");
	let created = await page.evaluate((input) => window.desktop.createWorkspace(input), {
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
	const beforeUndo = await readFile(todoPath, "utf8");
	const sorted = await page.evaluate((input) => window.desktop.setWorkspaceSortOrder(input), {
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		sortOrder: "due",
	});
	assert.equal(sorted.status, "applied");
	assert.equal(sorted.confirmed.session.catalogue.workspaces[0].sort_order, "due");
	assert.equal(await readFile(todoPath, "utf8"), beforeUndo);
	await page.addInitScript(() => {
		window.startupHomeSeen = false;
		new MutationObserver(() => {
			if (
				document.querySelector(
					'nav[aria-label="Saved workspaces"], [aria-label="No active workspace"], [aria-label="Loading workspace session"]'
				)
			)
				window.startupHomeSeen = true;
		}).observe(document, { childList: true, subtree: true });
	});
	await reopen();
	await page.getByRole("button", { name: "Sort Todo items", exact: true }).waitFor();
	assert.equal(
		await page.getByRole("link", { name: "Home", exact: true }).count(),
		0,
		"Daily navigation uses the Workspace switcher"
	);
	assert.equal(
		await page.evaluate(() => window.startupHomeSeen),
		false,
		"Restoring an Active workspace must never render Home"
	);
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

	assert.equal(
		await page.getByRole("button", { name: "Sort Todo items", exact: true }).getAttribute("title"),
		"Sort: Due date"
	);
	const restoredSort = await page.evaluate(() => window.desktop.readSession({}));
	const unsorted = await page.evaluate((input) => window.desktop.setWorkspaceSortOrder(input), {
		scope: restoredSort.scope,
		revision: restoredSort.revision,
		workspaceId: restoredSort.session.catalogue.active_workspace_id,
		sortOrder: "file",
	});
	assert.equal(unsorted.status, "applied");
	created = unsorted;
	console.log(
		"Workspace sort order persists through preload/IPC and renderer reload without changing the Todo file."
	);
	await page.evaluate((input) => window.desktop.createTodo(input), {
		scope: created.confirmed.scope,
		revision: created.confirmed.revision,
		workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		description: "Undo bridge test",
		projects: [],
		contexts: [],
	});
	await reopen();
	const undoButton = page.getByRole("button", { name: "Undo creation", exact: true });
	await undoButton.waitFor();
	assert.equal(await undoButton.isEnabled(), true);
	await undoButton.click();
	await page.getByRole("button", { name: "Undo last change", exact: true }).waitFor();
	assert.equal(
		await page.getByRole("button", { name: "Undo last change", exact: true }).isDisabled(),
		true
	);
	assert.equal(await readFile(todoPath, "utf8"), beforeUndo);
	created = {
		status: "applied",
		confirmed: await page.evaluate(() => window.desktop.readSession({})),
	};
	await assert.rejects(
		page.evaluate((input) => window.desktop.undoTodo({ ...input, contents: "overwrite" }), {
			scope: created.confirmed.scope,
			revision: created.confirmed.revision,
			workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		})
	);
	console.log(
		"Topbar Undo restores exact contents through preload/IPC and consumes its single slot."
	);
	const savedView = await page.evaluate((input) => window.desktop.saveView(input), {
		workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		name: "Calls",
		filters: {
			status: "all",
			search: "Call",
			project: null,
			context: null,
			priority: null,
			due: null,
		},
	});
	assert.equal(savedView.status, "applied");
	assert.deepEqual(await page.evaluate(() => window.desktop.readSavedViews({})), savedView);
	await assert.rejects(
		page.evaluate((input) => window.desktop.saveView(input), {
			workspaceId: created.confirmed.session.catalogue.active_workspace_id,
			name: "Invalid",
			filters: {
				status: "open",
				search: "",
				project: null,
				context: null,
				priority: null,
				due: "tomorrow",
			},
		})
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

	const beforeBulk = await readFile(todoPath, "utf8");
	const bulkSource = `${beforeBulk}Another open item\r\n`;
	await writeFile(todoPath, bulkSource);
	const bulkSession = await page.evaluate(() => window.desktop.restoreSession({}));
	const bulkTarget = {
		completed: true,
		scope: bulkSession.scope,
		revision: bulkSession.revision,
		workspaceId: bulkSession.session.catalogue.active_workspace_id,
		targets: bulkSession.session.todo_file.items.map((item) => ({
			lineNumber: item.line_number,
			expectedRaw: item.raw,
		})),
	};
	assert.equal(
		await page.evaluate(async (input) => {
			try {
				await window.desktop.bulkSetTodoCompletion({ ...input, targets: [] });
				return false;
			} catch {
				return true;
			}
		}, bulkTarget),
		true
	);
	const bulkCompleted = await page.evaluate(
		(input) => window.desktop.bulkSetTodoCompletion(input),
		bulkTarget
	);
	assert.equal(bulkCompleted.status, "applied");
	assert.equal(bulkCompleted.confirmed.todo_file.items.filter((item) => !item.completed).length, 0);
	assert.equal(bulkCompleted.confirmed.undoLabel, "Undo completion");
	const bulkUndone = await page.evaluate((input) => window.desktop.undoTodo(input), {
		scope: bulkCompleted.confirmed.scope,
		revision: bulkCompleted.confirmed.revision,
		workspaceId: bulkCompleted.confirmed.workspaceId,
	});
	assert.equal(bulkUndone.status, "applied");
	assert.equal(await readFile(todoPath, "utf8"), bulkSource);
	const bulkReopened = await page.evaluate((input) => window.desktop.bulkSetTodoCompletion(input), {
		...bulkTarget,
		completed: false,
		revision: bulkUndone.confirmed.revision,
		targets: bulkUndone.confirmed.todo_file.items.map((item) => ({
			lineNumber: item.line_number,
			expectedRaw: item.raw,
		})),
	});
	assert.equal(bulkReopened.status, "applied");
	assert.equal(
		bulkReopened.confirmed.todo_file.items.some((item) => item.completed),
		false
	);
	assert.equal(bulkReopened.confirmed.undoLabel, "Undo uncompletion");
	const reopeningUndone = await page.evaluate((input) => window.desktop.undoTodo(input), {
		scope: bulkReopened.confirmed.scope,
		revision: bulkReopened.confirmed.revision,
		workspaceId: bulkReopened.confirmed.workspaceId,
	});
	assert.equal(reopeningUndone.status, "applied");
	assert.equal(await readFile(todoPath, "utf8"), bulkSource);
	await writeFile(todoPath, beforeBulk);
	switched.confirmed = await page.evaluate(() => window.desktop.restoreSession({}));

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
	await reopen();
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
	assert.deepEqual(await page.evaluate(() => window.desktop.readSavedViews({})), savedView);
	await page.getByRole("button", { name: "Saved views", exact: true }).click();
	await page.getByRole("button", { name: "Calls", exact: true }).click();
	await page.getByRole("searchbox", { name: "Search Todo items" }).waitFor();
	assert.equal(
		await page.getByRole("searchbox", { name: "Search Todo items" }).inputValue(),
		"Call"
	);
	await page.getByRole("button", { name: "Clear search", exact: true }).click();
	const deletedView = await page.evaluate((input) => window.desktop.deleteView(input), {
		workspaceId: created.confirmed.session.catalogue.active_workspace_id,
		viewId: savedView.views[0].id,
	});
	assert.deepEqual(deletedView, { status: "applied", views: [] });

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
	await reopen();
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
	await reopen();
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
	await reopen();
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

	const bulkDeletionSource =
		"Before +Hidden\r\n(A) 2026-10-01 Batch one +Batch @desk custom:keep\n\n2026-13-01 Invalid\r\nx 2026-10-12 2026-10-02 Batch two +Batch\tcustom:value\r\nAfter +Hidden";
	await writeFile(deletionPath, bulkDeletionSource);
	const bulkDeletionSession = await page.evaluate(() => window.desktop.restoreSession({}));
	const bulkDeletionTarget = {
		scope: bulkDeletionSession.scope,
		revision: bulkDeletionSession.revision,
		workspaceId: bulkDeletionSession.session.catalogue.active_workspace_id,
		targets: bulkDeletionSession.session.todo_file.items
			.filter((item) => item.projects.includes("Batch"))
			.map((item) => ({ lineNumber: item.line_number, expectedRaw: item.raw })),
	};
	for (const targets of [[], [bulkDeletionTarget.targets[0], bulkDeletionTarget.targets[0]]]) {
		assert.equal(
			await page.evaluate(
				async (input) => {
					try {
						await window.desktop.bulkDeleteTodos(input);
						return false;
					} catch {
						return true;
					}
				},
				{ ...bulkDeletionTarget, targets }
			),
			true
		);
		assert.equal(await readFile(deletionPath, "utf8"), bulkDeletionSource);
	}
	await reopen();
	await page.getByRole("button", { name: "Toggle Todo-item search", exact: true }).click();
	await page.getByRole("searchbox", { name: "Search Todo items", exact: true }).fill("Batch");
	await page.getByRole("button", { name: "Select items", exact: true }).click();
	await page.getByRole("button", { name: "Select all", exact: true }).click();
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	const bulkDeleteDialog = page.getByRole("alertdialog", { name: "Delete 2 Todo items?" });
	await bulkDeleteDialog.waitFor();
	assert.equal(await readFile(deletionPath, "utf8"), bulkDeletionSource);
	await bulkDeleteDialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await bulkDeleteDialog.waitFor({ state: "detached" });
	assert.equal(await page.getByText("2 selected", { exact: true }).count(), 1);
	assert.equal(await readFile(deletionPath, "utf8"), bulkDeletionSource);
	await page.getByRole("button", { name: "Delete", exact: true }).click();
	await bulkDeleteDialog.getByRole("button", { name: "Delete Todo items", exact: true }).click();
	await bulkDeleteDialog.waitFor({ state: "detached" });
	await page.getByText("Deleted 2 Todo items", { exact: true }).waitFor();
	assert.equal(
		await readFile(deletionPath, "utf8"),
		"Before +Hidden\r\n\n2026-13-01 Invalid\r\nAfter +Hidden"
	);
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("aria-label") === "Exit selection mode"
	);
	const afterBulkDeletion = await page.evaluate(() => window.desktop.readSession({}));
	assert.equal(afterBulkDeletion.undoLabel, "Undo deletion");
	assert.equal(await page.getByText("0 selected", { exact: true }).count(), 1);
	assert.equal(
		await page.getByRole("button", { name: "Undo deletion", exact: true }).isDisabled(),
		true
	);
	await page.getByRole("button", { name: "Exit selection mode", exact: true }).click();
	await page.getByRole("button", { name: "Undo deletion", exact: true }).click();
	await page.getByRole("button", { name: "Undo last change", exact: true }).waitFor();
	await page.getByText("Batch one", { exact: true }).waitFor();
	await page.getByText("Batch two", { exact: true }).waitFor();
	assert.equal(await readFile(deletionPath, "utf8"), bulkDeletionSource);
	console.log(
		"Bulk deletion confirms once, preserves hidden/skipped content, and undoes the entire batch exactly through the UI and preload/IPC."
	);

	// Exercise appearance with enough real Todo items to overflow the reader.
	await writeFile(
		deletionPath,
		Array.from({ length: 1000 }, (_, index) => `Item ${index + 1}`).join("\n")
	);
	await reopen();
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
	// Dialog autofocus runs on the next animation frame, after the surface becomes visible.
	await page.waitForFunction(
		(dialog) => dialog.contains(document.activeElement),
		await help.elementHandle()
	);
	assert.ok((await help.textContent()).includes(process.platform === "darwin" ? "⌘" : "Ctrl"));
	await page.keyboard.press(`${mod}+f`);
	assert.equal(await todoSearch.count(), 0, "Help keeps Todo-item search closed");
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
			(await clipboard.read())
				.filter((item) => item.types.length > 0)
				.map(
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
			if (globalThis.clipboardBeforeCopyTest.length)
				await clipboard.write(globalThis.clipboardBeforeCopyTest);
			else clipboard.clear();
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
	await reopen();
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
	await reopen();
	await addTodo.click({ trial: true });
	await page.getByRole("list", { name: "Todo items", exact: true }).focus();
	await page.keyboard.press("End");
	await page.getByText("Edited metadata check", { exact: true }).waitFor();
	console.log(
		"Todo-item editing through the row menu, form, preload and backend persists across reload."
	);
	console.log("Metadata entered through the form persists in the Todo file and after reload.");
	const thresholdPath = join(directory, "threshold.todo");
	const thresholdContents = [
		"(A) Future chore +Chores @home due:2000-01-01 t:2000-01-01 t:9999-12-31",
		"Unsupported threshold t:9999-12-31 t:+2d",
		"Impossible threshold t:2026-02-30",
		"Actionable chore t:2000-01-01",
		"x 2026-10-09 Completed chore t:9999-12-31",
	].join("\r\n");
	await writeFile(thresholdPath, thresholdContents);
	const thresholdWorkspace = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Thresholds",
		color: "violet",
		todoPath: thresholdPath,
	});
	assert.equal(thresholdWorkspace.status, "applied");
	await reopen();
	await page.getByText("Actionable chore", { exact: true }).waitFor();
	const showDeferred = page.getByRole("button", { name: "Show deferred", exact: true });
	assert.equal(await showDeferred.getAttribute("aria-pressed"), "false");
	assert.equal((await showDeferred.innerText()).trim(), "1");
	assert.equal(await page.getByText("Future chore", { exact: true }).count(), 0);
	assert.ok(await page.getByText("Unsupported threshold", { exact: true }).isVisible());
	assert.ok(await page.getByText("Impossible threshold", { exact: true }).isVisible());
	assert.ok(await page.getByText("Completed chore", { exact: true }).isVisible());
	await page.getByRole("button", { name: "Priority A", exact: true }).click();
	const deferredEmpty = page.getByLabel("No matching Todo items", { exact: true });
	await deferredEmpty.waitFor();
	await deferredEmpty.getByRole("button", { name: "Show deferred", exact: true }).click();
	await page.getByText("Future chore", { exact: true }).waitFor();
	assert.ok(await page.getByTitle("Show from 9999-12-31 · Deferred", { exact: true }).isVisible());
	assert.ok(await page.getByTitle("Overdue · 2000-01-01", { exact: true }).isVisible());
	await reopen();
	await page.getByText("Future chore", { exact: true }).waitFor();
	assert.equal(
		await showDeferred.getAttribute("aria-pressed"),
		"true",
		"Show deferred survives renderer reload"
	);
	await page.getByRole("button", { name: "Priority A", exact: true }).click();
	const persistedVisibility = await page.evaluate(() => window.desktop.readSession({}));
	assert.equal(
		persistedVisibility.session.catalogue.workspaces.find(
			(w) => w.id === thresholdWorkspace.confirmed.session.catalogue.active_workspace_id
		).show_deferred,
		true
	);
	await page.getByRole("button", { name: "Navigate Future chore", exact: true }).click();
	await page.getByRole("heading", { name: "Future chore", exact: true }).waitFor();
	assert.ok(
		await page
			.locator("[data-todo-details]")
			.getByTitle("Show from 9999-12-31 · Deferred", { exact: true })
			.isVisible()
	);
	await page.getByRole("button", { name: "Close details", exact: true }).click();
	await page.getByRole("button", { name: "Clear filters", exact: true }).click();
	await page.getByText("Actionable chore", { exact: true }).waitFor();
	assert.equal(
		await showDeferred.getAttribute("aria-pressed"),
		"true",
		"Clear filters preserves Workspace visibility"
	);
	await showDeferred.click();
	await page.waitForFunction(
		() =>
			document.querySelector('button[aria-label="Show deferred"]').getAttribute("aria-pressed") ===
			"false"
	);
	await page.getByRole("button", { name: /^Completed/ }).click();
	assert.ok(await showDeferred.isDisabled());
	assert.equal((await showDeferred.innerText()).trim(), "");
	assert.ok(await page.getByText("Completed chore", { exact: true }).isVisible());
	assert.equal(
		await readFile(thresholdPath, "utf8"),
		thresholdContents,
		"Threshold visibility must never rewrite the Todo file"
	);
	console.log(
		"Threshold visibility respects effective metadata, completion views, filters, independent dates, and exact file preservation."
	);
	await page.getByRole("button", { name: /^All/ }).click();
	await page.getByRole("button", { name: "Actions for Actionable chore", exact: true }).click();
	await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
	const thresholdPicker = page.getByRole("button", { name: "Show from (optional)" });
	assert.equal(await thresholdPicker.innerText(), "January 1, 2000");
	await page.getByPlaceholder("Add key:value").fill("t:2099-01-01");
	await page.getByPlaceholder("Add key:value").press("Enter");
	await thresholdPicker.click();
	await page.getByRole("button", { name: /January 2, 2099/ }).click();
	await thresholdPicker.click();
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await page
		.getByText("Hidden until Show from 2099-01-02. Use Show deferred to see it.", { exact: true })
		.waitFor();
	assert.equal(
		await page.getByRole("button", { name: "Actions for Actionable chore", exact: true }).count(),
		0
	);
	assert.equal(await showDeferred.getAttribute("aria-pressed"), "false");
	assert.equal(
		await readFile(thresholdPath, "utf8"),
		thresholdContents.replace("Actionable chore t:2000-01-01", "Actionable chore t:2099-01-02")
	);
	await page.getByRole("button", { name: "Undo edit", exact: true }).click();
	await page.getByText("Actionable chore", { exact: true }).waitFor();
	assert.equal(await readFile(thresholdPath, "utf8"), thresholdContents);
	console.log(
		"Show from calendar editing replaces repeated thresholds, explains hidden items, and undoes exact bytes through preload/IPC."
	);

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

	const recurringPath = join(directory, "recurring.txt");
	const recurringBytes = "(A) Clean rec:1m\r\nLast";
	await writeFile(recurringPath, recurringBytes);
	const recurringWorkspace = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Recurring",
		color: "blue",
		todoPath: recurringPath,
	});
	assert.equal(recurringWorkspace.status, "applied");
	await reopen();
	await page.getByRole("checkbox", { name: "Mark Clean complete", exact: true }).click();
	await page.getByText(/^Next occurrence due \d{4}-\d{2}-\d{2}\.$/).waitFor();
	let recurrenceState = await page.evaluate(() => window.desktop.readSession({}));
	assert.equal(recurrenceState.session.todo_file.items.length, 3);
	assert.equal(recurrenceState.session.todo_file.items[0].metadata["tuxedo-generated"], "1");
	assert.equal(recurrenceState.session.todo_file.items[1].priority, "A");
	await page.getByRole("button", { name: "Undo completion", exact: true }).click();
	await page.getByRole("button", { name: "Undo last change", exact: true }).waitFor();
	await page.getByRole("checkbox", { name: "Mark Clean complete", exact: true }).waitFor();
	assert.equal(await readFile(recurringPath, "utf8"), recurringBytes);
	await page.getByRole("button", { name: "Actions for Clean", exact: true }).click();
	await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
	await page.getByRole("textbox", { name: /Description/ }).fill("Edited chore");
	await page.getByRole("checkbox", { name: "Completed", exact: true }).click();
	await page.getByRole("button", { name: "Save changes", exact: true }).click();
	await page.getByRole("dialog").waitFor({ state: "hidden" });
	recurrenceState = await page.evaluate(() => window.desktop.readSession({}));
	assert.equal(recurrenceState.session.todo_file.items.length, 3);
	assert.equal(recurrenceState.session.todo_file.items[1].description, "Edited chore");
	await page.getByRole("button", { name: "Undo edit", exact: true }).click();
	await page.getByRole("button", { name: "Undo last change", exact: true }).waitFor();
	await page.getByRole("checkbox", { name: "Mark Clean complete", exact: true }).waitFor();
	assert.equal(await readFile(recurringPath, "utf8"), recurringBytes);
	console.log(
		"Checkbox and editor recurrence generate one successor through preload/IPC; Undo restores exact CRLF/EOF bytes."
	);
	const recurringBatchPath = join(directory, "recurring-batch.txt");
	const recurringBatchBytes =
		"Batch monthly rec:1m\r\nOrdinary\nBatch weekly rec:1w\nBatch unsupported rec:+1w\nHidden rec:1d";
	await writeFile(recurringBatchPath, recurringBatchBytes);
	const recurringBatchWorkspace = await page.evaluate(
		(input) => window.desktop.createWorkspace(input),
		{
			name: "Recurring batch",
			color: "green",
			todoPath: recurringBatchPath,
		}
	);
	assert.equal(recurringBatchWorkspace.status, "applied");
	await reopen();
	await page.getByRole("button", { name: "Toggle Todo-item search", exact: true }).click();
	await page.getByRole("searchbox", { name: "Search Todo items", exact: true }).fill("Batch");
	await page.getByRole("button", { name: "Select items", exact: true }).click();
	await page.getByRole("button", { name: "Select all", exact: true }).click();
	await page.getByText("3 selected", { exact: true }).waitFor();
	await page.getByRole("button", { name: "Complete", exact: true }).click();
	await page.getByText("Completed 3 Todo items", { exact: true }).waitFor();
	await page
		.getByText("Generated 2 next occurrences. Skipped 1 unsupported Repeat rule.", { exact: true })
		.waitFor();
	await page.getByText("0 selected", { exact: true }).waitFor();
	const recurringBatchState = await page.evaluate(() => window.desktop.readSession({}));
	const batchItems = recurringBatchState.session.todo_file.items;
	assert.equal(batchItems.length, 7);
	assert.deepEqual(
		batchItems.map((item) => item.description),
		[
			"Batch monthly",
			"Batch monthly",
			"Ordinary",
			"Batch weekly",
			"Batch weekly",
			"Batch unsupported",
			"Hidden",
		]
	);
	assert.equal(batchItems.filter((item) => item.completed).length, 3);
	assert.equal(batchItems[0].metadata["tuxedo-generated"], "1");
	assert.equal(batchItems[3].metadata["tuxedo-generated"], "1");
	assert.equal(batchItems[1].metadata["tuxedo-generated"], undefined);
	assert.equal(batchItems[4].metadata["tuxedo-generated"], undefined);
	assert.equal(
		await page.getByRole("searchbox", { name: "Search Todo items", exact: true }).inputValue(),
		"Batch"
	);
	await page.getByRole("button", { name: "Exit selection mode", exact: true }).click();
	await page.getByRole("button", { name: "Undo completion", exact: true }).click();
	await page.getByRole("button", { name: "Undo last change", exact: true }).waitFor();
	assert.equal(await readFile(recurringBatchPath, "utf8"), recurringBatchBytes);
	console.log(
		"Bulk recurring completion reports aggregate counts, preserves filtered-out items, and undoes exact mixed-ending bytes through the real selection UI."
	);
	const leadPath = join(directory, "lead.txt");
	const leadBytes = "Mow rec:1m due:2020-01-10 t:2020-01-07\n";
	await writeFile(leadPath, leadBytes);
	const leadWorkspace = await page.evaluate((input) => window.desktop.createWorkspace(input), {
		name: "Lead time",
		color: "green",
		todoPath: leadPath,
	});
	assert.equal(leadWorkspace.status, "applied");
	await reopen();
	await page.getByRole("checkbox", { name: "Mark Mow complete", exact: true }).click();
	await page
		.getByText(/^Next occurrence due \d{4}-\d{2}-\d{2}\. Show from \d{4}-\d{2}-\d{2}\.$/)
		.waitFor();
	const leadState = await page.evaluate(() => window.desktop.readSession({}));
	assert.equal(leadState.session.todo_file.items[0].metadata.t, "2020-01-07");
	const leadSuccessor = leadState.session.todo_file.items[1];
	const day = 24 * 60 * 60 * 1000;
	assert.equal(
		(Date.parse(`${leadSuccessor.metadata.due}T00:00:00Z`) -
			Date.parse(`${leadSuccessor.metadata.t}T00:00:00Z`)) /
			day,
		3
	);
	const showDeferredLead = page.getByRole("button", { name: "Show deferred", exact: true });
	assert.equal(await showDeferredLead.getAttribute("aria-pressed"), "false");
	assert.equal((await showDeferredLead.innerText()).trim(), "1");
	assert.equal(await page.getByText("Mow", { exact: true }).count(), 1);
	await showDeferredLead.click();
	await page.getByTitle(/^Show from \d{4}-\d{2}-\d{2} · Deferred$/).waitFor();
	assert.equal(await page.getByText("Mow", { exact: true }).count(), 2);
	await page.getByRole("button", { name: "Undo completion", exact: true }).click();
	await page.getByRole("button", { name: "Undo last change", exact: true }).waitFor();
	assert.equal(await readFile(leadPath, "utf8"), leadBytes);
	console.log(
		"Recurring completion preserves Show from lead time, hides the future successor, and undoes the whole change."
	);
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

	const routeIds = {};
	for (const [name, item] of [
		["Route A", "Alpha item"],
		["Route B", "Beta item"],
	]) {
		const routePath = join(directory, `${name.replace(" ", "-")}.txt`);
		await writeFile(routePath, `${item}\n`);
		const routed = await page.evaluate((input) => window.desktop.createWorkspace(input), {
			name,
			color: "violet",
			todoPath: routePath,
		});
		routeIds[name] = routed.confirmed.session.catalogue.active_workspace_id;
	}
	const routeUrl = (path) => new URL(path, page.url()).href;
	const recoverHome = async () => {
		await page.goto(routeUrl("/workspaces/00000000-0000-4000-8000-000000000000"));
		await page.waitForURL(routeUrl("/"));
		await page.getByLabel("Workspace home", { exact: true }).waitFor();
	};
	const activeId = async () =>
		(await page.evaluate(() => window.desktop.readSession({}))).session.catalogue
			.active_workspace_id;
	const expectRoute = async (name, item) => {
		await page.waitForURL(routeUrl(`/workspaces/${routeIds[name]}`));
		await page.getByText(item, { exact: true }).waitFor();
		assert.equal(await activeId(), routeIds[name]);
	};
	await reopen();
	await expectRoute("Route B", "Beta item");
	await recoverHome();
	await page.waitForURL(routeUrl("/"));
	await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
	assert.equal(await page.locator("[data-slot='sidebar']").count(), 0);
	assert.equal(await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).count(), 0);
	assert.equal(await activeId(), routeIds["Route B"], "Home preserves the Active workspace");
	const createdPath = join(directory, "Route-C.txt");
	await writeFile(createdPath, "Gamma item\n");
	await application.evaluate(({ ipcMain }, path) => {
		ipcMain.removeHandler("tuxedo:select-todo-file");
		ipcMain.handle("tuxedo:select-todo-file", () => path);
	}, createdPath);
	await page.getByRole("button", { name: "New workspace", exact: true }).click();
	await page.getByRole("textbox", { name: "Workspace name" }).fill("Route C");
	await page.getByRole("button", { name: "Todo file", exact: true }).click();
	await page.getByText(createdPath, { exact: true }).waitFor();
	await page.getByRole("button", { name: "Create workspace", exact: true }).click();
	await page.getByText("Gamma item", { exact: true }).waitFor();
	routeIds["Route C"] = await activeId();
	await expectRoute("Route C", "Gamma item");
	await recoverHome();
	await page.getByRole("link", { name: "Route A", exact: true }).click();
	await expectRoute("Route A", "Alpha item");
	await page.getByRole("button", { name: "Select workspace: Route A" }).click();
	await page.getByRole("menuitem", { name: "Route B", exact: true }).click();
	await expectRoute("Route B", "Beta item");
	const historyLength = await page.evaluate(() => history.length);
	await page.goBack();
	await expectRoute("Route A", "Alpha item");
	await page.goForward();
	await expectRoute("Route B", "Beta item");
	assert.equal(await page.evaluate(() => history.length), historyLength);
	console.log(
		"Home, picker, creation, switcher, Back and Forward switch the persisted Active workspace."
	);

	await page.getByRole("checkbox", { name: "Mark Beta item complete", exact: true }).click();
	const routeUndo = page.getByRole("button", { name: "Undo completion", exact: true });
	await routeUndo.waitFor();
	await recoverHome();
	await page.getByRole("link", { name: "Route B", exact: true }).click();
	await expectRoute("Route B", "Beta item");
	assert.ok(await routeUndo.isEnabled(), "Returning from Home keeps Undo");
	await page.getByRole("button", { name: "Select workspace: Route B" }).click();
	await page.getByRole("menuitem", { name: "Route A", exact: true }).click();
	await expectRoute("Route A", "Alpha item");
	await page.goBack();
	await expectRoute("Route B", "Beta item");
	await page.getByRole("button", { name: "Undo last change", exact: true }).waitFor();
	console.log("Home keeps the Undo opportunity; history switches clear it.");

	await reopen();
	await expectRoute("Route B", "Beta item");
	// A kept startup entry would make Back stop at the picker.
	await page.goBack();
	await expectRoute("Route B", "Beta item");
	await page.goto(routeUrl(`/workspaces/${routeIds["Route A"]}`));
	await expectRoute("Route A", "Alpha item");
	await page.reload();
	await expectRoute("Route A", "Alpha item");
	await recoverHome();
	assert.equal(await activeId(), routeIds["Route A"], "A failed switch keeps the session");
	await page.getByText("Workspace unavailable", { exact: true }).waitFor();
	assert.equal(await page.getByText("Alpha item", { exact: true }).count(), 0);
	assert.equal(await page.locator("[data-slot='sidebar']").count(), 0);
	await page.reload();
	await expectRoute("Route A", "Alpha item");
	console.log(
		"Unavailable nested destinations recover on Home; reload resumes the confirmed Active workspace."
	);

	await rm(join(directory, "Route-A.txt"));
	await page.waitForURL(routeUrl("/"));
	await page.getByLabel("Workspace home", { exact: true }).waitFor();
	await page.getByText("Workspace unavailable", { exact: true }).waitFor();
	await page
		.getByText("This Todo file couldn’t be found. It may have been moved or deleted.", {
			exact: true,
		})
		.waitFor();
	assert.equal(await page.getByText("Alpha item", { exact: true }).count(), 0);
	assert.equal(await page.locator("[data-slot='sidebar']").count(), 0);
	await writeFile(join(directory, "Route-A.txt"), "Alpha item\n");
	await page.getByRole("link", { name: "Route A", exact: true }).click();
	await expectRoute("Route A", "Alpha item");
	console.log(
		"An unreadable Todo file returns to Home and can be reopened from its row after recovery."
	);
	await application.evaluate(({ ipcMain }) => {
		ipcMain.removeHandler("tuxedo:switch-workspace");
		ipcMain.handle(
			"tuxedo:switch-workspace",
			() => new Promise((resolve) => (globalThis.releaseSwitch = resolve))
		);
	});
	await page.getByRole("button", { name: "Select workspace: Route A" }).click();
	await page.getByRole("menuitem", { name: "Route B", exact: true }).click();
	await page.getByLabel("Opening workspace", { exact: true }).waitFor();
	const pendingUrl = page.url();
	await page.evaluate(() => history.back());
	await page.waitForTimeout(300);
	assert.equal(page.url(), pendingUrl, "Back is blocked during a Workspace session operation");
	assert.equal(await page.getByText("Alpha item", { exact: true }).count(), 0);
	await application.evaluate(() =>
		globalThis.releaseSwitch({ status: "rejected", message: "Held switch failed" })
	);
	await page.getByText("Held switch failed", { exact: true }).waitFor();
	assert.equal(await activeId(), routeIds["Route A"]);
	await page.waitForURL(routeUrl("/"));
	await page.getByLabel("Workspace home", { exact: true }).waitFor();
	assert.equal(await page.locator("[data-slot='sidebar']").count(), 0);
	console.log(
		"Navigation waits for admitted operations; failed switches recover on Home and retain the session."
	);
	await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
	const removeFromHome = async (name, cancel = false) => {
		await page.getByRole("button", { name: `Options for ${name}`, exact: true }).click();
		const removal = page.getByRole("menuitem", { name: "Remove workspace", exact: true });
		assert.equal(
			await removal.evaluate((element) => {
				const text = [...element.childNodes].find(
					(node) =>
						node.nodeType === Node.TEXT_NODE && node.textContent.includes("Remove workspace")
				);
				const range = document.createRange();
				range.selectNodeContents(text);
				return range.getClientRects().length;
			}),
			1,
			"Remove workspace must fit on one line"
		);
		await removal.click();
		const confirmation = page.getByRole("alertdialog");
		await confirmation.waitFor();
		assert.match(
			await confirmation.innerText(),
			new RegExp(`Remove ${name} from saved Workspaces`)
		);
		assert.equal(new URL(page.url()).pathname, "/", "Options must not open the Workspace");
		await confirmation
			.getByRole("button", { name: cancel ? "Cancel" : "Remove workspace", exact: true })
			.click();
		await confirmation.waitFor({ state: "hidden" });
		if (!cancel) await page.getByRole("link", { name, exact: true }).waitFor({ state: "hidden" });
	};
	await removeFromHome("Route C", true);
	assert.equal(await page.getByRole("link", { name: "Route C", exact: true }).count(), 1);
	assert.equal(await activeId(), routeIds["Route A"]);
	await removeFromHome("Route C");
	assert.equal(await readFile(createdPath, "utf8"), "Gamma item\n");
	assert.equal(
		await activeId(),
		routeIds["Route A"],
		"Removing an inactive Workspace keeps the active one"
	);
	await removeFromHome("Route A");
	assert.equal(await activeId(), null);
	assert.equal(await readFile(join(directory, "Route-A.txt"), "utf8"), "Alpha item\n");
	await page.reload();
	await page.getByRole("navigation", { name: "Saved workspaces" }).waitFor();
	assert.equal(await page.getByRole("link", { name: "Route A", exact: true }).count(), 0);
	assert.equal(await page.getByRole("link", { name: "Route C", exact: true }).count(), 0);
	assert.equal(await page.locator("[data-slot='sidebar']").count(), 0);
	console.log(
		"Home Workspace options cancel or remove active/inactive references without navigating or deleting Todo files."
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
