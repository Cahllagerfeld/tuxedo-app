import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import TagsInput from "./tags-input.svelte";

test("refocusing before blur settles keeps suggestions open", async () => {
	render(TagsInput, {
		placeholder: "Project",
		suggestions: ["External"],
		validate: (value) => value,
	});
	const projects = page.getByPlaceholder("Project");
	await projects.click();
	const input = projects.element() as HTMLInputElement;
	vi.useFakeTimers();
	try {
		input.blur();
		input.focus();
		await vi.advanceTimersByTimeAsync(150);
	} finally {
		vi.useRealTimers();
	}
	await expect.element(projects).toHaveFocus();
	await expect.element(page.getByRole("option", { name: "External" })).toBeVisible();
});
