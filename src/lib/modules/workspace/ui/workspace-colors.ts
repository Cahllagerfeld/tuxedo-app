import type { Workspace } from "../domain/workspace";

export const workspaceColorClasses: Record<Workspace["color"], string> = {
	blue: "bg-blue-600 dark:bg-blue-400",
	green: "bg-green-600 dark:bg-green-400",
	amber: "bg-amber-600 dark:bg-amber-400",
	red: "bg-red-600 dark:bg-red-400",
	violet: "bg-violet-600 dark:bg-violet-400",
	pink: "bg-pink-600 dark:bg-pink-400",
	cyan: "bg-cyan-600 dark:bg-cyan-400",
	orange: "bg-orange-600 dark:bg-orange-400",
};
