import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import TagsInput from "./tags-input.svelte";
import TagsInputSuggestion from "./tags-input-suggestion.svelte";
import "../../../../../routes/layout.css";

test("Tab skips suggestions and reaches the next control", async () => {
	render(TagsInput, { placeholder: "Project", suggestions: ["Work"], validate: (value) => value });
	const next = document.createElement("button");
	next.textContent = "Next field";
	document.body.append(next);
	try {
		await page.getByPlaceholder("Project").click();
		await expect.element(page.getByRole("option", { name: "Work" })).toBeVisible();
		await userEvent.keyboard("{Tab}");
		await expect.element(page.getByRole("button", { name: "Next field" })).toHaveFocus();
	} finally {
		next.remove();
	}
});

test("suggestions support click activation without a mouse-down event", async () => {
	const onSelect = vi.fn();
	render(TagsInputSuggestion, { id: "work-option", value: "Work", active: false, onSelect });
	page
		.getByRole("option", { name: "Work" })
		.element()
		.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	expect(onSelect).toHaveBeenCalledWith("Work");
});

test("keyboard selection highlights the tag before deletion", async () => {
	render(TagsInput, { value: ["Work"], placeholder: "Project", validate: (value) => value });
	await page.getByPlaceholder("Project").click();
	const tag = page.getByText("Work", { exact: true }).element().parentElement!;
	const before = getComputedStyle(tag).boxShadow;
	await userEvent.keyboard("{Backspace}");
	await expect.poll(() => getComputedStyle(tag).boxShadow).not.toBe(before);
	await userEvent.keyboard("{Backspace}");
	await expect.element(page.getByText("Work", { exact: true })).not.toBeInTheDocument();
});

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
