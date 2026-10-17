import { expect, test } from "vitest";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type {
	ConfirmedSession,
	DesktopAPI,
	TodoFileObservation,
} from "../src/lib/shared/desktop/contract";

declare global {
	interface Window {
		holdTodoWrite: () => Promise<void>;
		holdWorkspaceSwitch: () => Promise<void>;
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
				const snapshot = (): ConfirmedSession => ({
					scope,
					revision,
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
					"restoreSession" | "readSavedViews" | "switchWorkspace" | "setTodoCompletion"
				> &
					TodoFileObservation = {
					restoreSession: async () => snapshot(),
					readSavedViews: async () => ({ status: "applied", views: [] }),
					onTodoFileChanged: () => () => {},
					switchWorkspace: async ({ workspaceId }) => {
						await window.holdWorkspaceSwitch();
						active = workspaceId;
						revision++;
						return { status: "applied", confirmed: snapshot() };
					},
					setTodoCompletion: async () => {
						await window.holdTodoWrite();
						completed = true;
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
			},
			{ first, second }
		);
		await page.goto(await origin);
		const item = page.getByRole("checkbox", { name: "Mark Navigation item complete", exact: true });
		await item.waitFor();
		const home = page.getByRole("link", { name: "Home", exact: true }).first();
		await home.click();
		await page.getByRole("heading", { name: "Workspaces", exact: true }).waitFor();
		await page.getByRole("link", { name: "blue Work", exact: true }).click();
		await item.waitFor();
		// Keep both Back and Forward destinations available around the admitted write.
		await home.click();
		await page.getByRole("heading", { name: "Workspaces", exact: true }).waitFor();
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
		expect(page.url()).toBe(destination);
		expect(await item.isVisible()).toBe(true);
		expect(await item.isDisabled()).toBe(true);
		finishWrite();
		await page
			.getByRole("checkbox", { name: "Mark Navigation item incomplete", exact: true })
			.waitFor();
		await page.goForward();
		await page.getByRole("heading", { name: "Workspaces", exact: true }).waitFor();
		await page.getByRole("link", { name: "blue Personal", exact: true }).click();
		await expect.poll(() => !!finishSwitch).toBe(true);
		await traverse("back");
		expect(page.url()).toContain("/workspaces/");
		expect(await page.getByRole("checkbox").count()).toBe(0);
		finishSwitch!();
		await page
			.getByRole("checkbox", { name: "Mark Navigation item incomplete", exact: true })
			.waitFor();
		expect(new URL(page.url()).pathname).toBe(`/workspaces/${second}`);
		expect(await page.getByLabel("Reader status").textContent()).toContain("Personal");
		expect(
			await page
				.getByRole("button", { name: "Navigate Navigation item", exact: true })
				.getAttribute("tabindex")
		).toBe("-1");
		await page.keyboard.press("Space");
		expect(writes).toBe(1);
	} finally {
		await browser.close();
		if (server.exitCode === null) {
			const exited = once(server, "exit");
			server.kill();
			await exited;
		}
	}
}, 30000);
