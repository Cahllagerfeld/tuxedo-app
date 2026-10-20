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
		routingState: () => {
			active: string;
			revision: number;
			reads: string[];
			switches: number;
			restores: number;
		};
		makeTodoFileUnreadable: () => void;
		makeTodoFileReadable: () => void;
		failSessionReads: (count: number) => void;
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
		const pendingReads: (() => void)[] = [];
		await page.exposeFunction("holdSessionRead", () => {
			if (!holdRefresh) return;
			return new Promise<void>((done) => {
				pendingReads.push(done);
				finishRefresh = () => pendingReads.splice(0).forEach((finish) => finish());
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
				let confirmedUnreadable = false;
				let restores = 0;
				let failReads = 0;
				let undoLabel: ConfirmedSession["undoLabel"];
				window.failSessionReads = (count) => {
					failReads += count;
				};
				const reads: string[] = [];
				let switches = 0;
				window.routingState = () => ({ active, revision, reads, switches, restores });
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
						reads.push(active);
						await window.holdSessionRead();
						if (failReads) {
							failReads--;
							throw Error("Follow-up read unavailable");
						}
						const confirmed = snapshot();
						return confirmedUnreadable && confirmed.session.status === "ready"
							? {
									...confirmed,
									session: {
										status: "empty",
										catalogue: confirmed.session.catalogue,
										warning: "Todo file unreadable",
									},
								}
							: confirmed;
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
						restores++;
						if (sessionStorage.getItem("failStartup")) {
							sessionStorage.removeItem("failStartup");
							throw Error("Startup bridge unavailable");
						}
						confirmedUnreadable = unreadable;
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
						if (workspaceId !== first && workspaceId !== second)
							return { status: "rejected", message: "Workspace no longer exists" };
						if (sessionStorage.getItem("throwActivation")) {
							sessionStorage.removeItem("throwActivation");
							throw Error("Workspace bridge unavailable");
						}
						if (sessionStorage.getItem("failActivation")) {
							sessionStorage.removeItem("failActivation");
							return { status: "rejected", message: "Catalogue is read-only" };
						}
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
				window.makeTodoFileReadable = () => {
					unreadable = false;
				};
			},
			{ first, second }
		);
		await page.goto(await origin);
		const item = page.getByRole("checkbox", { name: "Mark Navigation item complete", exact: true });
		await item.waitFor();
		expect(await page.getByRole("link", { name: "Home", exact: true }).count()).toBe(0);
		const visit = (path: string) =>
			page.evaluate(`(async () => {
			const { goto } = await import("/node_modules/@sveltejs/kit/src/runtime/app/navigation.js");
			try { await goto(${JSON.stringify(path)}); } catch { /* Admission can cancel this navigation. */ }
		})()`);
		await visit("/workspaces");
		await item.waitFor();
		expect(new URL(page.url()).pathname).toBe(`/workspaces/${first}`);
		const recoverHome = () => visit("/workspaces/00000000-0000-4000-8000-000000000000");
		await recoverHome();
		await page.getByRole("heading", { name: "Your workspaces.", exact: true }).waitFor();
		const beforePreload = await page.evaluate(() => window.routingState());
		await page.getByRole("link", { name: "Personal", exact: true }).hover();
		// Keep this browser import out of Vitest's SSR module transform.
		await page.evaluate(`(async () => {
			const { preloadData } = await import("/node_modules/@sveltejs/kit/src/runtime/app/navigation.js");
			const { load } = await import("/src/routes/+layout.ts");
			const { queryClient } = await load();
			const { workspaceQueryKeys } = await import("/src/lib/modules/workspace/state/workspace-queries.ts");
			await preloadData("/workspaces/${second}");
			await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.session });
			await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.session });
		})()`);
		const afterPreload = await page.evaluate(() => window.routingState());
		expect(afterPreload.active).toBe(beforePreload.active);
		expect(afterPreload.revision).toBe(beforePreload.revision);
		expect(afterPreload.switches).toBe(beforePreload.switches);
		expect(afterPreload.restores).toBe(beforePreload.restores);
		expect(afterPreload.reads.every((id) => id === first)).toBe(true);
		await page.getByRole("link", { name: "Work", exact: true }).click();
		await item.waitFor();
		await page.getByRole("button", { name: "Navigate Navigation item", exact: true }).click();
		const closeDetails = page.getByRole("button", { name: "Close details", exact: true });
		await closeDetails.focus();
		await page.evaluate(`(async () => {
			const { load } = await import("/src/routes/+layout.ts");
			const { queryClient } = await load();
			const { workspaceQueryKeys } = await import("/src/lib/modules/workspace/state/workspace-queries.ts");
			await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.destination("${first}"), refetchType: "all" });
		})()`);
		expect(await closeDetails.isVisible()).toBe(true);
		expect(await closeDetails.evaluate((element) => element === document.activeElement)).toBe(true);
		await closeDetails.click();
		// Keep both Back and Forward destinations available around the admitted write.
		await recoverHome();
		await page.getByRole("heading", { name: "Your workspaces.", exact: true }).waitFor();
		await expect
			.poll(() => page.getByRole("link", { name: "Work", exact: true }).isEnabled())
			.toBe(true);
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
		await visit("/workspaces");
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
		await visit("/workspaces");
		await traverse("back");
		expect(page.url()).toBe(destination);
		expect(writes).toBe(1);
		holdRefresh = false;
		finishRefresh!();
		await page
			.getByRole("checkbox", { name: "Mark Navigation item incomplete", exact: true })
			.waitFor();
		const switchesBeforeFailedRead = (await page.evaluate(() => window.routingState())).switches;
		await page.evaluate(() => window.failSessionReads(2));
		await page
			.getByRole("checkbox", { name: "Mark Navigation item incomplete", exact: true })
			.click();
		await expect.poll(() => writes).toBe(2);
		finishWrite();
		await page.getByText("Follow-up read unavailable", { exact: true }).waitFor();
		expect(new URL(page.url()).pathname).toBe("/workspaces");
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
		await recoverHome();
		await page.getByRole("heading", { name: "Your workspaces.", exact: true }).waitFor();
		await page.getByRole("link", { name: "Personal", exact: true }).click();
		await expect.poll(() => !!finishSwitch).toBe(true);
		await traverse("back");
		expect(new URL(page.url()).pathname).toBe("/workspaces");
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

		// Switching keeps the outgoing reader mounted; cancellation cannot start another activation.
		const outgoingReader = await item.elementHandle();
		finishSwitch = undefined;
		await page.evaluate(`(async () => {
			const { goto } = await import("/node_modules/@sveltejs/kit/src/runtime/app/navigation.js");
			try { await goto("/workspaces/${first}"); } catch { /* Admission resumes this destination. */ }
		})()`);
		await expect.poll(() => !!finishSwitch).toBe(true);
		expect(new URL(page.url()).pathname).toBe(`/workspaces/${second}`);
		expect(await outgoingReader!.evaluate((node) => node.isConnected)).toBe(true);
		expect(await item.isVisible()).toBe(true);
		expect(await item.isDisabled()).toBe(true);
		await page.evaluate(`(async () => {
			const { goto } = await import("/node_modules/@sveltejs/kit/src/runtime/app/navigation.js");
			try { await goto("/workspaces"); } catch { /* The pending switch blocks another destination. */ }
		})()`);
		expect((await page.evaluate(() => window.routingState())).switches).toBe(2);
		finishSwitch!();
		await page.waitForURL(`**/workspaces/${first}`);
		await expect
			.poll(() => page.getByLabel("Reader status").textContent())
			.toContain("Workspace: Work");
		await expect.poll(() => item.isEnabled()).toBe(true);
		const historyEntries = await page.evaluate(() =>
			window.navigation.entries().map((entry) => entry.key)
		);
		finishSwitch = undefined;
		await traverse("back");
		await expect.poll(() => !!finishSwitch).toBe(true);
		expect(new URL(page.url()).pathname).toBe(`/workspaces/${first}`);
		expect(await item.isVisible()).toBe(true);
		finishSwitch!();
		await page.waitForURL(`**/workspaces/${second}`);
		await expect.poll(() => page.getByLabel("Reader status").textContent()).toContain("Personal");
		expect(
			await page.evaluate(() => window.navigation.entries().map((entry) => entry.key))
		).toEqual(historyEntries);

		await page.evaluate(() => sessionStorage.setItem("failActivation", "1"));
		await traverse("forward");
		await page.getByRole("heading", { name: "Your workspaces.", exact: true }).waitFor();
		expect(new URL(page.url()).pathname).toBe("/workspaces");
		await page
			.getByRole("region", { name: "Workspace home", exact: true })
			.getByText("Catalogue is read-only", { exact: true })
			.waitFor();
		expect((await page.evaluate(() => window.routingState())).active).toBe(second);
		await page.goBack();
		await item.waitFor();
		await page.evaluate(() => sessionStorage.setItem("throwActivation", "1"));
		await page.evaluate(`(async () => {
			const { goto } = await import("/node_modules/@sveltejs/kit/src/runtime/app/navigation.js");
			try { await goto("/workspaces/${first}"); } catch { /* Admission resumes the failed destination. */ }
		})()`);
		await page.getByRole("heading", { name: "Your workspaces.", exact: true }).waitFor();
		await page
			.getByRole("region", { name: "Workspace home", exact: true })
			.getByText("Workspace bridge unavailable", { exact: true })
			.waitFor();
		expect((await page.evaluate(() => window.routingState())).active).toBe(second);
		await page.goBack();
		await item.waitFor();

		await page.getByRole("button", { name: "Navigate Navigation item", exact: true }).click();
		await page.getByRole("button", { name: "Close details", exact: true }).focus();
		const restoresBeforeNavigation = (await page.evaluate(() => window.routingState())).restores;
		holdRefresh = true;
		finishRefresh = undefined;
		await page.evaluate(`(async () => {
			const { goto } = await import("/node_modules/@sveltejs/kit/src/runtime/app/navigation.js");
			const { load } = await import("/src/routes/+layout.ts");
			const { queryClient } = await load();
			const { workspaceQueryKeys } = await import("/src/lib/modules/workspace/state/workspace-queries.ts");
			await queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.destinations, refetchType: "none" });
			void goto(location.href, { invalidateAll: true, keepFocus: true, noScroll: true });
		})()`);
		await expect.poll(() => !!finishRefresh).toBe(true);
		expect(await item.isVisible()).toBe(true);
		expect(await item.isDisabled()).toBe(true);
		await page.evaluate(() => window.makeTodoFileUnreadable());
		expect((await page.evaluate(() => window.routingState())).restores).toBe(
			restoresBeforeNavigation
		);
		holdRefresh = false;
		finishRefresh!();
		await page.getByRole("heading", { name: "Your workspaces.", exact: true }).waitFor();
		await expect
			.poll(() => page.evaluate(() => window.routingState().restores))
			.toBe(restoresBeforeNavigation + 1);
		await expect
			.poll(() => page.evaluate(() => document.activeElement === document.body))
			.toBe(true);
		expect(new URL(page.url()).pathname).toBe("/workspaces");
		expect(await page.getByText("Todo file unreadable", { exact: true }).isVisible()).toBe(true);
		await page.evaluate(() => window.makeTodoFileReadable());
		await page.getByRole("button", { name: "Retry", exact: true }).click();
		await item.waitFor();
		await page.evaluate(() => sessionStorage.setItem("failStartup", "1"));
		await page.goto(new URL("/", page.url()).href);
		await page.getByText("Startup bridge unavailable", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Retry", exact: true }).click();
		await item.waitFor();
		await page.evaluate(() => sessionStorage.setItem("failActivation", "1"));
		await page.goto(new URL(`/workspaces/${second}`, page.url()).href);
		await page.getByText("Catalogue is read-only", { exact: true }).waitFor();
		expect((await page.evaluate(() => window.routingState())).active).toBe(first);
		await page.getByRole("heading", { name: "Your workspaces.", exact: true }).waitFor();
		expect(new URL(page.url()).pathname).toBe("/workspaces");
		expect(await page.getByRole("link", { name: "Work", exact: true }).isVisible()).toBe(true);
	} finally {
		await browser.close();
		if (server.exitCode === null) {
			const exited = once(server, "exit");
			server.kill();
			await exited;
		}
	}
}, 30000);
