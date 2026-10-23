export function recurrenceLabel(value: string | undefined): string | null {
	const rule = /^([1-9][0-9]*)([dwmy])$/u.exec(value ?? "");
	if (!rule) return null;
	const units: Record<string, string> = { d: "day", w: "week", m: "month", y: "year" };
	return `${rule[1]} ${units[rule[2]]}${rule[1] === "1" ? "" : "s"}`;
}
