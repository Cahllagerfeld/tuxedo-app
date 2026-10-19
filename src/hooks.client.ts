import { prepareWorkspaceEntry } from "$lib/app/workspace-entry";

// Startup is an actual entry, unlike a load that may run for speculative preloading.
export const init = prepareWorkspaceEntry;
