import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import {
	createDesktopClient,
	switchWorkspaceRequestSchema,
	type ConfirmedSession,
	type DesktopAPI,
} from "$lib/shared/desktop/contract";
import type { AppState } from "./app-state.svelte";
import { workspacePath, type createWorkspaceNavigation } from "./workspace-navigation.svelte";
import Harness from "./WorkspaceNavigationHarness.svelte";

const router = vi.hoisted(() => ({
	page: { params: {} as { id?: string }, url: new URL("https://tuxedo.test/") },
	navigating: { to: null as { params: { id?: string } } | null },
	before: (_event: { cancel: () => void }) => {},
	confirm: async (_event: { to: { params: { id?: string } } }) => {},
	goto: vi.fn<(path: string, options?: { replaceState?: boolean }) => Promise<void>>(),
}));
vi.mock("$app/state", () => ({ page: router.page, navigating: router.navigating }));
vi.mock("$app/navigation", () => ({
	goto: router.goto,
	beforeNavigate: (callback: typeof router.before) => {
		router.before = callback;
	},
	onNavigate: (callback: typeof router.confirm) => {
		router.confirm = callback;
	},
}));
afterEach(() => vi.unstubAllGlobals());

const a = "550e8400-e29b-41d4-a716-446655440000";
const b = "550e8400-e29b-41d4-a716-446655440001";
const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const saved = [a, b].map((id, index) => ({
	id,
	name: index ? "Personal" : "Work",
	color: "blue" as const,
	todo_path: `/tmp/${id}.txt`,
	created_at: `2026-10-1${index + 1}T00:00:00Z`,
}));
function ready(id: string, revision = 1): ConfirmedSession {
	return {
		scope,
		revision,
		session: {
			status: "ready",
			catalogue: { version: 1, active_workspace_id: id, workspaces: saved },
			todo_file: { path: `/tmp/${id}.txt`, items: [], skipped: [] },
		},
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function setup(
	options: {
		path?: string;
		restore?: DesktopAPI["restoreSession"];
		switchWorkspace?: DesktopAPI["switchWorkspace"];
		createWorkspace?: DesktopAPI["createWorkspace"];
	} = {}
) {
	let revision = 1;
	const switches: string[] = [];
	const desktop = createDesktopClient(async (channel, input) => {
		if (channel === "tuxedo:restore-session")
			return options.restore ? options.restore({}) : ready(a);
		if (channel === "tuxedo:read-saved-views") return { status: "applied", views: [] };
		if (channel === "tuxedo:switch-workspace") {
			const request = switchWorkspaceRequestSchema.parse(input);
			switches.push(request.workspaceId);
			return options.switchWorkspace
				? options.switchWorkspace(request)
				: { status: "applied", confirmed: ready(request.workspaceId, ++revision) };
		}
		if (channel === "tuxedo:create-workspace" && options.createWorkspace)
			return options.createWorkspace({
				name: "Personal",
				color: "blue",
				todoPath: `/tmp/${b}.txt`,
			});
		throw Error(`Unexpected ${channel}`);
	});
	vi.stubGlobal("desktop", { ...desktop, onTodoFileChanged: () => () => {} });
	const params = (path: string) =>
		path.startsWith("/workspaces/") ? { id: decodeURIComponent(path.slice(12)) } : {};
	router.page.url = new URL(options.path ?? "/", "https://tuxedo.test");
	router.page.params = params(router.page.url.pathname);
	router.navigating.to = null;
	const entries = [router.page.url.pathname];
	async function navigate(path: string, options?: { replaceState?: boolean }, history = false) {
		let canceled = false;
		router.before({
			cancel: () => {
				canceled = true;
			},
		});
		if (canceled) return;
		const to = { params: params(path) };
		router.navigating.to = to;
		await router.confirm({ to });
		router.page.params = to.params;
		router.page.url = new URL(path, router.page.url);
		if (!history) {
			if (options?.replaceState) entries[entries.length - 1] = path;
			else entries.push(path);
		}
		router.navigating.to = null;
	}
	router.goto.mockReset().mockImplementation(navigate);
	let app!: AppState;
	let navigation!: ReturnType<typeof createWorkspaceNavigation>;
	render(Harness, {
		desktop,
		ready: (state, routes) => {
			app = state;
			navigation = routes;
		},
	});
	return {
		app,
		navigation,
		switches,
		entries,
		traverse: (id: string) => navigate(workspacePath(id), undefined, true),
	};
}
const settled = async (navigation: ReturnType<typeof createWorkspaceNavigation>) => {
	await expect.poll(() => navigation.busy).toBe(false);
};

test("startup replaces Home once; explicit Home preserves the remembered Workspace", async () => {
	const { app, navigation, entries, switches } = setup();
	await settled(navigation);
	expect(entries).toEqual([workspacePath(a)]);
	expect(switches).toEqual([]);
	expect(navigation.readerAvailable).toBe(true);
	await navigation.goHome();
	expect(router.page.url.pathname).toBe("/");
	expect(app.workspace.activeWorkspace?.id).toBe(a);
	expect(navigation.readerAvailable).toBe(false);
});

test("nested reload and returning from Home reuse matching confirmed data and Undo", async () => {
	const { app, navigation, switches } = setup({
		path: workspacePath(a),
		restore: async () => ({ ...ready(a), undoLabel: "Undo creation" }),
	});
	await settled(navigation);
	await navigation.goHome();
	await navigation.openWorkspace(a);
	expect(navigation.readerAvailable).toBe(true);
	expect(app.workspace.undoLabel).toBe("Undo creation");
	expect(switches).toEqual([]);
});

test("an explicit deep destination wins; pending confirmation never exposes the restored reader", async () => {
	const pending = deferred<Awaited<ReturnType<DesktopAPI["switchWorkspace"]>>>();
	const { app, navigation, switches } = setup({
		path: workspacePath(b),
		switchWorkspace: () => pending.promise,
	});
	await expect.poll(() => switches.length).toBe(1);
	expect(app.workspace.activeWorkspace?.id).toBe(a);
	expect(navigation.readerAvailable).toBe(false);
	expect(navigation.busy).toBe(true);
	pending.resolve({ status: "applied", confirmed: ready(b, 2) });
	await settled(navigation);
	expect(app.workspace.activeWorkspace?.id).toBe(b);
	expect(navigation.readerAvailable).toBe(true);
});

test("startup restoration blocks navigation; explicit Home after startup stays Home", async () => {
	const pending = deferred<ConfirmedSession>();
	const { navigation, entries } = setup({ restore: () => pending.promise });
	await navigation.goHome();
	expect(await navigation.openWorkspace(b)).toMatchObject({ status: "rejected" });
	pending.resolve(ready(a));
	await settled(navigation);
	await navigation.goHome();
	expect(entries).toEqual([workspacePath(a), "/"]);
});

test("SvelteKit pending navigation blocks duplicate requests and closes ephemeral UI", async () => {
	const pending = deferred<Awaited<ReturnType<DesktopAPI["switchWorkspace"]>>>();
	const { app, navigation, entries, switches } = setup({ switchWorkspace: () => pending.promise });
	await settled(navigation);
	app.isTodoCreationOpen = true;
	app.bulkSelection.enter();
	const opening = navigation.openWorkspace(b);
	expect(navigation.busy).toBe(true);
	expect(navigation.readerAvailable).toBe(false);
	expect(app.isTodoCreationOpen).toBe(false);
	expect(app.todoBulkSelectionActive).toBe(false);
	expect(await navigation.openWorkspace(a)).toMatchObject({ status: "rejected" });
	pending.resolve({ status: "applied", confirmed: ready(b, 2) });
	await opening;
	expect(entries).toEqual([workspacePath(a), workspacePath(b)]);
	expect(switches).toEqual([b]);
});

test("failed destinations retain confirmed data but require Retry or Home", async () => {
	let attempts = 0;
	const { app, navigation, entries } = setup({
		switchWorkspace: async () =>
			++attempts === 1
				? { status: "rejected", message: "Todo file missing" }
				: { status: "applied", confirmed: ready(b, 2) },
	});
	await settled(navigation);
	await navigation.openWorkspace(b);
	expect(app.workspace.activeWorkspace?.id).toBe(a);
	expect(navigation.readerAvailable).toBe(false);
	expect(navigation.error).toBe("Todo file missing");
	await navigation.retry();
	expect(attempts).toBe(2);
	expect(navigation.readerAvailable).toBe(true);
	expect(entries).toHaveLength(2);
});

test("history confirms A/B without appending destinations", async () => {
	const { app, navigation, switches, entries, traverse } = setup();
	await settled(navigation);
	await navigation.openWorkspace(b);
	for (const id of [a, b]) {
		await traverse(id);
		expect(app.workspace.activeWorkspace?.id).toBe(id);
		expect(navigation.readerAvailable).toBe(true);
	}
	expect(switches).toEqual([b, a, b]);
	expect(entries).toHaveLength(2);
});

test("admitted session work blocks route and native traversal but retains the confirmed reader", async () => {
	const pending = deferred<ConfirmedSession>();
	let calls = 0;
	const { app, navigation, entries } = setup({
		restore: () => (++calls === 1 ? Promise.resolve(ready(a)) : pending.promise),
	});
	await settled(navigation);
	const restoring = app.workspace.restore();
	await navigation.goHome();
	expect(entries).toHaveLength(1);
	expect(navigation.readerAvailable).toBe(true);
	const event = Object.assign(new Event("navigate", { cancelable: true }), {
		navigationType: "traverse",
	});
	window.navigation.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(true);
	pending.resolve(ready(a, 2));
	await restoring;
	const later = Object.assign(new Event("navigate", { cancelable: true }), {
		navigationType: "traverse",
	});
	window.navigation.dispatchEvent(later);
	expect(later.defaultPrevented).toBe(false);
});

test("native traversal blocks SvelteKit's navigation gap even without a session operation", async () => {
	const { app, navigation } = setup();
	await settled(navigation);
	router.navigating.to = { params: { id: b } };
	expect(app.workspace.isOperating).toBe(false);
	const event = Object.assign(new Event("navigate", { cancelable: true }), {
		navigationType: "traverse",
	});
	window.navigation.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(true);
	router.navigating.to = null;
});

test("creation routes once without a redundant switch", async () => {
	const { navigation, switches, entries } = setup({
		createWorkspace: async () => ({ status: "applied", confirmed: ready(b, 2) }),
	});
	await settled(navigation);
	await navigation.goHome();
	await navigation.createWorkspace({ name: "Personal", color: "blue", todoPath: `/tmp/${b}.txt` });
	expect(router.page.url.pathname).toBe(workspacePath(b));
	expect(switches).toEqual([]);
	expect(entries).toEqual([workspacePath(a), "/", workspacePath(b)]);
});

test("Home retry rereads an unavailable Todo file even when its catalogue is already available", async () => {
	const restored = ready(a);
	if (restored.session.status !== "ready") throw Error("Invalid fixture");
	const unavailable: ConfirmedSession = {
		...restored,
		session: {
			status: "empty",
			catalogue: restored.session.catalogue,
			warning: "Todo file missing",
		},
	};
	let calls = 0;
	const { app, navigation } = setup({
		restore: async () => (++calls === 1 ? unavailable : ready(a, 2)),
	});
	await settled(navigation);
	expect(app.workspace.catalogue).not.toBeNull();
	await navigation.retry();
	expect(calls).toBe(2);
	expect(app.workspace.todoFile).not.toBeNull();
	expect(router.page.url.pathname).toBe("/");
});

test("catalogue failure remains safe and Retry restores without leaving Home", async () => {
	let calls = 0;
	const { app, navigation } = setup({
		restore: async () => {
			if (++calls === 1) throw Error("Catalogue unreadable");
			return ready(a);
		},
	});
	await settled(navigation);
	expect(app.workspace.error).toBe("Catalogue unreadable");
	await navigation.retry();
	expect(app.workspace.error).toBe("");
	expect(router.page.url.pathname).toBe("/");
	expect(navigation.readerAvailable).toBe(false);
});
