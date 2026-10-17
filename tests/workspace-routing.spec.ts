import { expect, test } from "vitest";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type {
	ConfirmedSession,
	DesktopAPI,
	TodoFileObservation,
	TodoFileChange,
} from "../src/lib/shared/desktop/contract";

declare global {
	interface Window {
		holdTodoWrite: () => Promise<void>;
		holdWorkspaceSwitch: () => Promise<void>;
		holdSessionRead: () => Promise<void>;
		routingState: () => { active: string; revision: number; reads: string[]; switches: number };
		makeTodoFileUnreadable: () => void;
		failNextSessionRead: () => void;
	}
}

test("real links and history preserve the reader during a write and block overlapping switches", async () => {
	const browser = await chromium.launch();
	const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", "0"], {
		env: { ...process.env, NO_COLOR: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const origin = new Promise<string>((done, reject) => {
		let output = "";
		server.stdout.on("data", (chunk) => {
			output += chunk;
			const url = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
			if (url) done(url[0]);
		});
		server.stderr.on("data", (chunk) => {
			output += chunk;
		});
		server.on("error", reject);
		server.on("exit", () => reject(Error(output)));
	});
	try {
		const page = await browser.newPage();
		page.setDefaultTimeout(10000);
		const first = "550e8400-e29b-41d4-a716-446655440000";
		const second = "550e8400-e29b-41d4-a716-446655440001";
		let finishWrite!: () => void;
		let finishSwitch: (() => void) | undefined;
		let writes = 0;
		let holdRefresh = false;
		let finishRefresh: (() => void) | undefined;
		await page.exposeFunction("holdSessionRead", () => {
			if (!holdRefresh) return;
			return new Promise<void>((done) => {
				finishRefresh = done;
			});
		});
		await page.exposeFunction("holdTodoWrite", () => {
			writes++;
			return new Promise<void>((done) => {
				finishWrite = done;
			});
		});
		await page.exposeFunction(
			"holdWorkspaceSwitch",
			() =>
				new Promise<void>((done) => {
					finishSwitch = done;
				})
		);
		await page.addInitScript(
			({ first, second }) => {
				const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
				let revision = 1;
				let active = first;
				let completed = false;
				let unreadable = false;
				let failReads = 0;
				let undoLabel: ConfirmedSession["undoLabel"];
				window.failNextSessionRead = () => {
					failReads++;
				};
				const reads: string[] = [];
				let switches = 0;
				window.routingState = () => ({ active, revision, reads, switches });
				let notify: ((event: TodoFileChange) => void) | undefined;
				const snapshot = (): ConfirmedSession => ({
					scope,
					revision,
					...(undoLabel ? { undoLabel } : {}),
					session: {
						status: "ready",
						catalogue: {
							version: 1,
							active_workspace_id: active,
							workspaces: [first, second].map((id, index) => ({
								id,
								name: index ? "Personal" : "Work",
								color: "blue",
								todo_path: `/tmp/${id}.txt`,
								created_at: `2026-10-1${index + 1}T00:00:00Z`,
							})),
						},
						todo_file: {
							path: `/tmp/${active}.txt`,
							skipped: [],
							items: [
								{
									line_number: 1,
									raw: `${completed ? "x " : ""}Navigation item`,
									description: "Navigation item",
									completed,
									priority: null,
									creation_date: null,
									completion_date: null,
									projects: [],
									contexts: [],
									metadata: {},
									edit: { description: "Navigation item", metadata: [] },
								},
							],
						},
					},
				});
				const desktop: Pick<
					DesktopAPI,
					| "readSession"
					| "readWorkspace"
					| "restoreSession"
					| "readSavedViews"
					| "switchWorkspace"
					| "setTodoCompletion"
				> &
					TodoFileObservation = {
					readSession: async () => {
						await window.holdSessionRead();
						if (failReads) {
							failReads--;
							throw Error("Follow-up read unavailable");
						}
						return desktop.restoreSession({});
					},
					readWorkspace: async ({ workspaceId }) => {
						reads.push(workspaceId);
						const confirmed = snapshot();
						if (confirmed.session.status !== "ready") throw Error("Expected Ready");
						const workspace = confirmed.session.catalogue.workspaces.find(
							(w) => w.id === workspaceId
						);
						return workspace && !unreadable
							? {
									status: "loaded",
									workspace,
									todo_file: { ...confirmed.session.todo_file, path: workspace.todo_path },
								}
							: { status: "rejected", message: "Todo file unreadable" };
					},
					restoreSession: async () => {
						const confirmed = snapshot();
						if (unreadable && confirmed.session.status === "ready")
							return {
								...confirmed,
								session: {
									status: "empty",
									catalogue: confirmed.session.catalogue,
									warning: "Todo file unreadable",
								},
							};
						return confirmed;
					},
					readSavedViews: async () => ({ status: "applied", views: [] }),
					onTodoFileChanged: (listener) => {
						notify = listener;
						return () => {
							notify = undefined;
						};
					},
					switchWorkspace: async ({ workspaceId }) => {
						switches++;
						await window.holdWorkspaceSwitch();
						active = workspaceId;
						undoLabel = undefined;
						revision++;
						return { status: "applied", confirmed: snapshot() };
					},
					setTodoCompletion: async ({ completed: nextCompleted }) => {
						await window.holdTodoWrite();
						completed = nextCompleted;
						undoLabel = completed ? "Undo completion" : "Undo uncompletion";
						revision++;
						const confirmed = snapshot();
						if (confirmed.session.status !== "ready") throw Error("Expected Ready");
						return {
							status: "applied",
							confirmed: {
								scope,
								revision,
								workspaceId: active,
								todo_file: confirmed.session.todo_file,
							},
						};
					},
				};
				Object.defineProperty(window, "desktop", { value: desktop });
				window.makeTodoFileUnreadable = () => {
					unreadable = true;
					notify?.({ scope, revision, workspaceId: active, todoPath: `/tmp/${active}.txt` });
				};
			},
			{ first, second }
		);
		await page.goto(await origin);
		const item = page.getByRole("checkbox", { name: "Mark Navigation item complete", exact: true });
		await item.waitFor();
		const home = page.getByRole("link", { name: "Home", exact: true }).first();
		await home.click();
		await page.getByRole("heading", { name: "Workspaces", exact: true }).waitFor();
		const beforePreload = await page.evaluate(() => window.routingState());
		await page.getByRole("link", { name: "blue Personal", exact: true }).hover();
		await expect.poll(() => page.evaluate(() => window.routingState().reads)).toContain(second);
		// Keep this browser import out of Vitest's SSR module transform.
		await page.evaluate(`(async () => {
			const { preloadData, invalidate } = await import("/node_modules/@sveltejs/kit/src/runtime/app/navigation.js");
			await preloadData("/workspaces/${second}");
			await invalidate(() => true);
			await invalidate(() => true);
		})()`);
		const afterPreload = await page.evaluate(() => window.routingState());
		expect(afterPreload.active).toBe(beforePreload.active);
		expect(afterPreload.revision).toBe(beforePreload.revision);
		expect(afterPreload.switches).toBe(beforePreload.switches);
		await page.getByRole("link", { name: "blue Work", exact: true }).click();
		await item.waitFor();
		await page.getByRole("button", { name: "Navigate Navigation item", exact: true }).click();
		const closeDetails = page.getByRole("button", { name: "Close details", exact: true });
		await closeDetails.focus();
		await page.evaluate(`(async () => {
			const { invalidate } = await import("/node_modules/@sveltejs/kit/src/runtime/app/navigation.js");
			await invalidate("desktop:session");
		})()`);
		expect(await closeDetails.isVisible()).toBe(true);
		expect(await closeDetails.evaluate((element) => element === document.activeElement)).toBe(true);
		await closeDetails.click();
		// Keep both Back and Forward destinations available around the admitted write.
		await home.click();
		await page.getByRole("heading", { name: "Workspaces", exact: true }).waitFor();
		await expect.poll(() => home.isDisabled()).toBe(false);
		await page.goBack();
		await item.waitFor();
		await item.click();
		await expect.poll(() => writes).toBe(1);
		const destination = page.url();
		const traverse = async (direction: "back" | "forward") => {
			await page.evaluate(async (direction) => {
				const attempted = new Promise<void>((done) => {
					window.navigation.addEventListener("navigate", () => done(), { once: true });
				});
				history[direction]();
				await attempted;
				await new Promise(requestAnimationFrame);
			}, direction);
		};
		await home.evaluate((link) => {
			if (link instanceof HTMLAnchorElement) link.click();
		});
		await traverse("back");
		await traverse("forward");
		await page.evaluate(`(async () => {
			const { goto } = await import("/node_modules/@sveltejs/kit/src/runtime/app/navigation.js");
			try { await goto("/workspaces/${second}"); } catch { /* Navigation is deliberately canceled. */ }
		})()`);
		expect((await page.evaluate(() => window.routingState())).switches).toBe(
			beforePreload.switches
		);
		expect(page.url()).toBe(destination);
		expect(await item.isVisible()).toBe(true);
		expect(await item.isDisabled()).toBe(true);
		holdRefresh = true;
		finishWrite();
		await expect.poll(() => !!finishRefresh).toBe(true);
		expect(await item.isVisible()).toBe(true);
		expect(await item.isDisabled()).toBe(true);
		await home.evaluate((link) => {
			if (link instanceof HTMLAnchorElement) link.click();
		});
		await traverse("back");
		expect(page.url()).toBe(destination);
		expect(writes).toBe(1);
		holdRefresh = false;
		finishRefresh!();
		await page
			.getByRole("checkbox", { name: "Mark Navigation item incomplete", exact: true })
			.waitFor();
		const switchesBeforeFailedRead = (await page.evaluate(() => window.routingState())).switches;
		await page.evaluate(() => window.failNextSessionRead());
		await page
			.getByRole("checkbox", { name: "Mark Navigation item incomplete", exact: true })
			.click();
		await expect.poll(() => writes).toBe(2);
		finishWrite();
		await page.getByRole("heading", { name: "Workspace unavailable" }).waitFor();
		await page
			.getByText(
				"Change saved, but the screen could not refresh. Retry loading before making another change.",
				{ exact: true }
			)
			.waitFor();
		expect(writes).toBe(2);
		await page.getByRole("button", { name: "Retry", exact: true }).click();
		await item.waitFor();
		await expect
			.poll(() => page.getByRole("button", { name: "Undo uncompletion", exact: true }).isEnabled())
			.toBe(true);
		expect((await page.evaluate(() => window.routingState())).switches).toBe(
			switchesBeforeFailedRead
		);
		expect(writes).toBe(2);
		await page.goForward();
		await page.getByRole("heading", { name: "Workspaces", exact: true }).waitFor();
		await page.getByRole("link", { name: "blue Personal", exact: true }).click();
		await expect.poll(() => !!finishSwitch).toBe(true);
		await traverse("back");
		expect(page.url()).toContain("/workspaces/");
		expect(await page.getByRole("checkbox").count()).toBe(0);
		finishSwitch!();
		await page
			.getByRole("checkbox", { name: "Mark Navigation item complete", exact: true })
			.waitFor();
		expect(new URL(page.url()).pathname).toBe(`/workspaces/${second}`);
		expect(await page.getByLabel("Reader status").textContent()).toContain("Personal");
		expect(
			await page
				.getByRole("button", { name: "Navigate Navigation item", exact: true })
				.getAttribute("tabindex")
		).toBe("-1");
		await page.keyboard.press("Space");
		expect(writes).toBe(2);

		await page.getByRole("button", { name: "Navigate Navigation item", exact: true }).click();
		await page.getByRole("button", { name: "Close details", exact: true }).focus();
		await page.evaluate(() => window.makeTodoFileUnreadable());
		await page.getByRole("heading", { name: "Workspace unavailable" }).waitFor();
		await expect
			.poll(() =>
				page
					.getByRole("region", { name: "Workspace destination" })
					.evaluate((element) => element === document.activeElement)
			)
			.toBe(true);
		await page.keyboard.press("Tab");
		expect(
			await page
				.getByRole("button", { name: "Retry", exact: true })
				.evaluate((element) => element === document.activeElement)
		).toBe(true);
	} finally {
		await browser.close();
		if (server.exitCode === null) {
			const exited = once(server, "exit");
			server.kill();
			await exited;
		}
	}
}, 30000);
