import { z } from "zod";
import { catalogueSchema } from "$lib/shared/desktop/contract";
export type WorkspaceCatalogue = z.infer<typeof catalogueSchema>;
export type Workspace = WorkspaceCatalogue["workspaces"][number];
