import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import TagsInput from "./tags-input.svelte";
import TagsInputSuggestion from "./tags-input-suggestion.svelte";
import Input from "$lib/shared/ui/input/input.svelte";
import "../../../../../routes/layout.css";

test.each(["light", "dark"])(
	"tag fields match the regular input focus ring in %s mode",
	async (theme) => {
		const wasDark = document.documentElement.classList.contains("dark");
		document.documentElement.classList.toggle("dark", theme === "dark");
		try {
			render(Input, { placeholder: "Regular input", class: "transition-none" });
			const regular = page.getByPlaceholder("Regular input");
			await regular.click();
			const focusedStyle = () => {
				const style = getComputedStyle(regular.element());
				return { shadow: style.boxShadow, border: style.borderColor };
			};
			await expect.poll(() => focusedStyle().shadow).toContain(" 3px,");
			const expected = focusedStyle();

			for (const placeholder of ["Project", "Context", "Metadata"]) {
				render(TagsInput, { placeholder, value: ["Existing"], validate: (value) => value });
				const input = page.getByPlaceholder(placeholder);
				const field = input.element().parentElement!;
				field.style.transition = "none";
				await input.click();
				await expect
					.poll(() => {
						const style = getComputedStyle(field);
						return { shadow: style.boxShadow, border: style.borderColor };
					})
					.toEqual(expected);
				await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
				await expect.poll(() => document.activeElement).toBe(field.querySelector("button"));
				await expect.poll(() => getComputedStyle(field).boxShadow).toBe(expected.shadow);
				await regular.click();
				await expect.poll(() => getComputedStyle(field).boxShadow).not.toBe(expected.shadow);
			}
		} finally {
			document.documentElement.classList.toggle("dark", wasDark);
		}
	}
);

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
