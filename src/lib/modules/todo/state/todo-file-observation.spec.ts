import { describe, expect, it, vi } from "vitest";
import { InMemoryTodoFileObservationAdapter } from "./todo-file-observation";

describe("Todo-file observation adapter", () => {
	it("starts observation on a path and delivers injected change signals", () => {
		const adapter = new InMemoryTodoFileObservationAdapter();
		const onChanged = vi.fn();

		adapter.start("/tmp/work.todo", onChanged);
		expect(adapter.observedPath).toBe("/tmp/work.todo");

		adapter.emitChanged();
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("retargets to a new Active Todo file path without dropping the change handler", () => {
		const adapter = new InMemoryTodoFileObservationAdapter();
		const onChanged = vi.fn();
		adapter.start("/tmp/work.todo", onChanged);

		adapter.retarget("/tmp/personal.todo");
		expect(adapter.observedPath).toBe("/tmp/personal.todo");

		adapter.emitChanged();
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("stops observation so further change signals are ignored", () => {
		const adapter = new InMemoryTodoFileObservationAdapter();
		const onChanged = vi.fn();
		adapter.start("/tmp/work.todo", onChanged);

		adapter.stop();
		expect(adapter.observedPath).toBeNull();

		adapter.emitChanged();
		expect(onChanged).not.toHaveBeenCalled();
	});

	it("retargets to null to leave no Active Todo file observed", () => {
		const adapter = new InMemoryTodoFileObservationAdapter();
		adapter.start("/tmp/work.todo", vi.fn());

		adapter.retarget(null);
		expect(adapter.observedPath).toBeNull();
	});
});
