import assert from "node:assert/strict";

export const readConfirmation = (page) => page.evaluate(() => window.desktop.readSession({}));

export async function activateWorkspace(page, workspaceId) {
	const result = await page.evaluate(
		(workspaceId) => window.desktop.switchWorkspace({ workspaceId }),
		workspaceId
	);
	assert.equal(result.status, "applied");
	return result.confirmed;
}
