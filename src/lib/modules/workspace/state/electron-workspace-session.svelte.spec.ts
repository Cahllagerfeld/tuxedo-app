import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ElectronSessionHarness from "./ElectronSessionHarness.svelte";
import type { ConfirmedSession } from "$lib/shared/desktop/contract";
const scope = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const confirmed = (revision: number, warning: string | null): ConfirmedSession => ({
	scope,
	revision,
	session: {
		status: "empty",
		catalogue: { version: 1, workspaces: [], active_workspace_id: null },
		warning,
	},
});
test("confirmed restoration rejects older results and exposes pending lifecycle state", async () => {
	let finish!: (value: ConfirmedSession) => void;
	render(ElectronSessionHarness, {
		desktop: {
			readSession: async () => confirmed(5, "Confirmed"),
			restoreSession: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		},
	});
	await expect.element(page.getByLabelText("Session warning")).toHaveTextContent("Confirmed");
	await page.getByRole("button", { name: "Restore" }).click();
	await expect.element(page.getByLabelText("Pending operation")).toHaveTextContent("restore");
	await expect.element(page.getByLabelText("Session status")).toHaveTextContent("empty");
	finish(confirmed(4, "Stale"));
	await expect.element(page.getByLabelText("Pending operation")).toHaveTextContent("none");
	await expect.element(page.getByLabelText("Session warning")).toHaveTextContent("Confirmed");
});
