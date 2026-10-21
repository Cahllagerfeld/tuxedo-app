import assert from "node:assert/strict";

// Derive existing confirmation through shipped resource reads; never accept or activate on read.
export const readConfirmation = (page) =>
	page.evaluate(async () => {
		const read = await window.desktop.readWorkspaceCatalogue({});
		if (read.status !== "ready" || !read.selection?.workspaceId) throw Error("Expected selection");
		const file = await window.desktop.readWorkspace({ workspaceId: read.selection.workspaceId });
		if (file.status !== "ready" || file.provenance.status !== "confirmed")
			throw Error("Expected confirmed contents");
		const { scope, revision, undoLabel } = file.provenance.selection;
		return {
			scope,
			revision,
			...(undoLabel ? { undoLabel } : {}),
			session: {
				status: "ready",
				catalogue: read.catalogue,
				todo_file: file.todo_file,
			},
		};
	});

export async function activateWorkspace(page, workspaceId) {
	const result = await page.evaluate(
		(workspaceId) => window.desktop.switchWorkspace({ workspaceId }),
		workspaceId
	);
	assert.equal(result.status, "applied");
	return result.confirmed;
}
