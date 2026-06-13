import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import SkippedLineDiagnostics from "./SkippedLineDiagnostics.svelte";

describe("SkippedLineDiagnostics.svelte", () => {
	it("renders skipped line details", async () => {
		render(SkippedLineDiagnostics, {
			skipped: [
				{
					line_number: 4,
					raw: "2024-99-99 invalid date",
					reason: "invalid creation date",
				},
				{
					line_number: 9,
					raw: "(A)",
					reason: "missing description",
				},
			],
		});

		await expect
			.element(page.getByRole("heading", { level: 2 }))
			.toHaveTextContent("2 lines were skipped");
		await expect
			.element(page.getByText("valid tasks are still shown", { exact: false }))
			.toBeInTheDocument();
		await expect.element(page.getByText("Line 4")).toBeInTheDocument();
		await expect.element(page.getByText("invalid creation date")).toBeInTheDocument();
		await expect.element(page.getByText("2024-99-99 invalid date")).toBeInTheDocument();
		await expect.element(page.getByText("Line 9")).toBeInTheDocument();
		await expect.element(page.getByText("missing description")).toBeInTheDocument();
		await expect.element(page.getByText("(A)")).toBeInTheDocument();
	});

	it("does not render when there are no skipped lines", async () => {
		render(SkippedLineDiagnostics, { skipped: [] });

		await expect
			.element(page.getByText("line was skipped", { exact: false }))
			.not.toBeInTheDocument();
	});
});
