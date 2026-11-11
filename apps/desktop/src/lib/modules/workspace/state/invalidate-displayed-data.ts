import { invalidate } from "$app/navigation";
import { navigating } from "$app/state";
import {
	savedViewsDependency,
	sessionDependency,
	workspaceDependency,
} from "./workspace-route-data";

export type DisplayedDataTarget = {
	session?: boolean;
	workspaceId?: string | null;
	savedViewsId?: string | null;
};
export type InvalidateDisplayedData = (target: DisplayedDataTarget) => Promise<void>;

let queue = Promise.resolve();

// SvelteKit drops an invalidation overtaken by another invalidation or a navigation, including a
// shallow one, resolving it without applying. Serializing them, after any in-flight navigation
// commits, means each resolved call has re-read its loaders.
export const serializeWithInvalidations = (task: () => Promise<void>) => {
	const next = queue.then(async () => {
		await navigating.complete?.catch(() => {});
		await task();
	});
	queue = next.catch(() => {});
	return next;
};

export const invalidateDisplayedData: InvalidateDisplayedData = ({
	session = false,
	workspaceId = null,
	savedViewsId = null,
}) =>
	serializeWithInvalidations(() =>
		invalidate(
			(dependency) =>
				(session && dependency.href === sessionDependency) ||
				(!!workspaceId && dependency.href === workspaceDependency(workspaceId)) ||
				(!!savedViewsId && dependency.href === savedViewsDependency(savedViewsId))
		)
	);
