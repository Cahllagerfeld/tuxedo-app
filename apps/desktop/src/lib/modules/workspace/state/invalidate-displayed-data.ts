import { invalidate } from "$app/navigation";
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

export const invalidateDisplayedData: InvalidateDisplayedData = ({
	session = false,
	workspaceId = null,
	savedViewsId = null,
}) =>
	invalidate(
		(dependency) =>
			(session && dependency.href === sessionDependency) ||
			(!!workspaceId && dependency.href === workspaceDependency(workspaceId)) ||
			(!!savedViewsId && dependency.href === savedViewsDependency(savedViewsId))
	);
