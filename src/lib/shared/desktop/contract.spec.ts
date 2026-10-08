import { expect, test } from "vitest";
import { createDesktopClient } from "./contract";
test("desktop transport rejects malformed responses", async () => {
	const desktop = createDesktopClient(async () => ({ revision: 0 }));
	await expect(desktop.readSession({})).rejects.toThrow();
});
test("desktop transport rejects unsupported request fields before invoking IPC", async () => {
	const desktop = createDesktopClient(async () => {
		throw Error("should not invoke");
	});
	await expect(desktop.readSession({ path: "/etc/passwd" } as never)).rejects.toThrow(
		"Unrecognized key"
	);
});
