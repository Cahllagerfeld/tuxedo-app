import type { Catalogue } from "@tuxedo/contracts";
export type WorkspaceCatalogue = Catalogue;
export type Workspace = WorkspaceCatalogue["workspaces"][number];
