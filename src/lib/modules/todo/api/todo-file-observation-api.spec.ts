import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createTodoFileObservationAdapter,
	TODO_FILE_CHANGED_EVENT,
} from "./todo-file-observation-api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

describe("createTodoFileObservationAdapter", () => {
	beforeEach(() => {
		vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
		vi.mocked(listen).mockReset();
	});

	it("removes its event listener when disposed", async () => {
		const unlisten = vi.fn();
		let emitChanged: (() => void) | undefined;
		vi.mocked(listen).mockImplementation(async (event, handler) => {
			expect(event).toBe(TODO_FILE_CHANGED_EVENT);
			emitChanged = () => handler({} as never);
			return unlisten;
		});
		const onChanged = vi.fn();
		const observation = createTodoFileObservationAdapter();
		await observation.start("/tmp/todo.txt", onChanged);

		await observation.dispose();
		emitChanged?.();

		expect(unlisten).toHaveBeenCalledOnce();
		expect(onChanged).not.toHaveBeenCalled();
	});
});
