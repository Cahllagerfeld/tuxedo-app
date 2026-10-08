import type { BrowserWindow, IpcMain } from "electron";
import type { z } from "zod";
import {
	desktopContract,
	type DesktopOperation,
	type DesktopRequest,
} from "../src/lib/shared/desktop/contract";
type Request<K extends DesktopOperation> = DesktopRequest<K>;
type Response<K extends DesktopOperation> = z.infer<(typeof desktopContract)[K]["response"]>;
export function registerDesktopOperation<K extends DesktopOperation>(
	ipc: IpcMain,
	window: BrowserWindow,
	trusted: (url: string) => boolean,
	operation: K,
	handler: (request: Request<K>) => Promise<Response<K>>
): void {
	const contract = desktopContract[operation];
	ipc.handle(contract.channel, async (event, request: unknown) => {
		if (
			event.sender !== window.webContents ||
			event.senderFrame !== window.webContents.mainFrame ||
			!trusted(event.senderFrame.url)
		)
			throw Error("Untrusted desktop sender");
		// The keyed schema is the source of truth for this operation at both boundaries.
		const input = contract.request.parse(request) as Request<K>;
		return contract.response.parse(await handler(input));
	});
}
