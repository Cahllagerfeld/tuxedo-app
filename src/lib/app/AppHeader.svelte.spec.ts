import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import AppHeader from "./AppHeader.svelte";
import { detectPlatform } from "@tanstack/svelte-hotkeys";
import AppHeaderHarness from "./AppHeaderHarness.svelte";

function pressModified(key: string, code: string, shiftKey = false) {
	const modifier = detectPlatform() === "mac" ? { metaKey: true } : { ctrlKey: true };
	document.dispatchEvent(
		new KeyboardEvent("keydown", { key, code, shiftKey, ...modifier, bubbles: true })
	);
	document.dispatchEvent(
		new KeyboardEvent("keyup", { key, code, shiftKey, ...modifier, bubbles: true })
	);
}

describe("AppHeader keyboard shortcuts", () => {
	it("opens discoverable shortcut help from the keyboard and restores the trigger on Escape", async () => {
		render(AppHeader);
		await expect.element(page.getByRole("button", { name: "Keyboard shortcuts" })).toBeVisible();
		pressModified("/", "Slash");

		await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
		await expect.element(page.getByText("Open workspace switcher")).toBeVisible();
		await expect.element(page.getByText("Toggle focused Todo item")).toBeVisible();

		await userEvent.keyboard("{Escape}");
		await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: "Keyboard shortcuts" })).toHaveFocus();
	});

	it("routes workspace shortcuts and respects operation availability", async () => {
		const view = await render(AppHeaderHarness, { disabled: false });
		pressModified("p", "KeyP");
		await expect.element(page.getByLabelText("Workspace switcher state")).toHaveTextContent("open");

		await view.rerender({ disabled: true });
		pressModified("n", "KeyN", true);
		await expect
			.element(page.getByLabelText("Workspace creation state"))
			.toHaveTextContent("closed");
	});

	it("opens help from its visible control", async () => {
		render(AppHeader);
		await userEvent.click(page.getByRole("button", { name: "Keyboard shortcuts" }));
		await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
	});
});
