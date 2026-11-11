import { describe, expect, it } from "vitest";
import { workspaceFilterQuery, workspaceFilters } from "./workspace-paths";

describe("Workspace filter URLs", () => {
	it("round-trips explicit selections and omits defaults", () => {
		const filters = {
			status: "open",
			search: "all & more",
			project: "Work",
			context: "Home",
			priority: "A",
			due: "today",
		} as const;
		const query = workspaceFilterQuery(filters);
		expect(workspaceFilters(new URLSearchParams(query))).toEqual(filters);
		expect(workspaceFilterQuery({ ...filters, status: "all", search: "", project: null })).toBe(
			"?context=Home&priority=A&due=today"
		);
		expect(workspaceFilterQuery(workspaceFilters(new URLSearchParams()))).toBe("");
	});

	it("ignores invalid values and selections a completed view cannot apply", () => {
		expect(
			workspaceFilters(
				new URLSearchParams("status=done&project=two%20words&priority=a&due=later&context=Home")
			)
		).toEqual({
			status: "all",
			search: "",
			project: null,
			context: "Home",
			priority: null,
			due: null,
		});
		expect(
			workspaceFilters(new URLSearchParams("status=completed&priority=A&due=today&search=x"))
		).toEqual({
			status: "completed",
			search: "x",
			project: null,
			context: null,
			priority: null,
			due: null,
		});
	});
});
