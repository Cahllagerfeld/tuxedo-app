import { todoRepeatRuleSchema } from "@tuxedo/contracts/todo-creation";

export function recurrenceLabel(value: string | undefined): string | null {
	if (!value || !todoRepeatRuleSchema.safeParse(value).success) return null;
	const interval = value.slice(0, -1);
	const units: Record<string, string> = { d: "day", w: "week", m: "month", y: "year" };
	return `${interval} ${units[value.slice(-1)]}${interval === "1" ? "" : "s"}`;
}
