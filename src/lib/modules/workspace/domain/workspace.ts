import type { Catalogue } from "$lib/shared/desktop/contract";
export type WorkspaceCatalogue = Catalogue;
export type Workspace = WorkspaceCatalogue["workspaces"][number];
