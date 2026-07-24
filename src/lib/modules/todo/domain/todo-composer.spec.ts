import { describe, expect, it } from "vitest";
import {
	isStructuredDescriptionToken,
	normalizeDescription,
	normalizeTag,
	todoComposerSchema,
} from "./todo-composer";

describe("todo composer validation", () => {
	it("normalizes Description whitespace and rejects structured tokens", () => {
		expect(normalizeDescription("  Call   Mom  ")).toBe("Call Mom");
		expect(isStructuredDescriptionToken("+Family")).toBe(true);
		expect(isStructuredDescriptionToken("@phone")).toBe(true);
		expect(isStructuredDescriptionToken("due:2026-07-24")).toBe(true);
		expect(isStructuredDescriptionToken("Call")).toBe(false);

		expect(
			todoComposerSchema.safeParse({ description: "  ", projects: [], contexts: [] }).success
		).toBe(false);
		expect(
			todoComposerSchema.safeParse({
				description: "Call Mom +Family",
				projects: [],
				contexts: [],
			}).success
		).toBe(false);
	});

	it("normalizes tag prefixes and rejects whitespace or duplicates", () => {
		expect(normalizeTag("+Family", "+")).toBe("Family");
		expect(normalizeTag("@phone", "@")).toBe("phone");
		expect(normalizeTag("Bad Project", "+")).toBeNull();

		const duplicate = todoComposerSchema.safeParse({
			description: "Call Mom",
			projects: ["Family", "Family"],
			contexts: [],
		});
		expect(duplicate.success).toBe(false);

		const ok = todoComposerSchema.safeParse({
			description: "  Call   Mom ",
			projects: ["+Family"],
			contexts: ["@phone"],
		});
		expect(ok.success).toBe(true);
		if (ok.success) {
			expect(ok.data).toEqual({
				description: "Call Mom",
				projects: ["Family"],
				contexts: ["phone"],
			});
		}
	});
});
