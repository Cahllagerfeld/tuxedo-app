import { readConfirmation } from "./testing/read-confirmation";
import { describe, expect, it, vi } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import { FileSystem } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplicationRuntime } from "../application-runtime";
import { createSessionBackend } from "../session-runtime";

describe("application shutdown", () => {
	it("stops admission synchronously and drains admitted work before releasing resources", async () => {
		const events: string[] = [];
		const runtime = ManagedRuntime.make(Layer.empty);
		const application = createApplicationRuntime(runtime);
		await application.run(
			"startup",
			Effect.addFinalizer(() => Effect.sync(() => events.push("release")))
		);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const first = application.run(
			"mutation",
			Effect.promise(() => gate).pipe(Effect.tap(() => Effect.sync(() => events.push("confirmed"))))
		);
		const quitting = application.dispose();
		await expect(
			application.run(
				"late request",
				Effect.sync(() => events.push("late"))
			)
		).rejects.toThrow("shutting down");
		expect(events).toEqual([]);
		release();
		await first;
		await quitting;
		expect(events).toEqual(["confirmed", "release"]);
		expect(application.dispose()).toBe(quitting);
	});

	it("finishes an in-flight Todo-item commit and queued read before releasing observers", async () => {
		const directory = await mkdtemp(join(tmpdir(), "tuxedo-shutdown-"));
		const todoPath = join(directory, "todo.txt");
		await writeFile(todoPath, "First");
		const fs = await Effect.runPromise(Effect.provide(FileSystem, NodeFileSystem.layer));
		let entered!: () => void;
		const replacing = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let observers = 0;
		const backend = createSessionBackend(
			join(directory, "workspaces.json"),
			{
				observe: () =>
					Effect.acquireRelease(
						Effect.sync(() => {
							observers++;
						}),
						() =>
							Effect.sync(() => {
								observers--;
							})
					),
			},
			undefined,
			{
				filesystem: {
					...fs,
					rename: (from, to) =>
						to.endsWith("todo.txt")
							? Effect.promise(async () => {
									entered();
									await gate;
								}).pipe(Effect.andThen(fs.rename(from, to)))
							: fs.rename(from, to),
				},
			}
		);
		try {
			const created = await backend.createWorkspace({ name: "Work", color: "blue", todoPath });
			if (created.status !== "applied" || created.confirmed.session.status !== "ready")
				throw Error("setup failed");
			const mutation = backend.createTodo({
				scope: created.confirmed.scope,
				revision: created.confirmed.revision,
				workspaceId: created.confirmed.session.catalogue.active_workspace_id!,
				description: "Added",
				projects: [],
				contexts: [],
				creationDate: null,
			});
			await replacing;
			const queued = backend.readSession({});
			const quitting = backend.shutdown();
			await expect(readConfirmation(backend)).rejects.toThrow("shutting down");
			await expect(backend.stopObservation()).rejects.toThrow("shutting down");
			await expect(backend.readSession({})).rejects.toThrow("shutting down");
			expect(observers).toBe(1);
			expect(await readFile(todoPath, "utf8")).toBe("First");
			release();
			const result = await mutation;
			expect(result.status).toBe("applied");
			if (result.status !== "applied") throw Error("mutation failed");
			expect(await queued).toMatchObject({
				revision: result.confirmed.revision,
				session: { status: "ready" },
			});
			expect(await quitting).toBe("complete");
			expect(observers).toBe(0);
			expect(await readFile(todoPath, "utf8")).toBe("First\nAdded");
		} finally {
			release();
			await backend.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("releases partially acquired startup resources and the runtime after startup failure", async () => {
		const events: string[] = [];
		const runtime = ManagedRuntime.make(
			Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(() => events.push("runtime"))))
		);
		const application = createApplicationRuntime(runtime);
		await expect(
			application.run(
				"startup",
				Effect.gen(function* () {
					yield* Effect.addFinalizer(() => Effect.sync(() => events.push("platform")));
					return yield* Effect.fail(Error("load failed"));
				})
			)
		).rejects.toThrow("load failed");
		expect(await application.shutdown()).toBe("complete");
		expect(events).toEqual(["platform", "runtime"]);
	});

	for (const phase of ["drain", "platform resources", "runtime disposal"] as const) {
		it(`bounds a stuck ${phase} with a diagnostic and keeps admission closed`, async () => {
			let release!: () => void;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const waiting = Effect.promise(() => gate);
			const runtime = ManagedRuntime.make(
				phase === "runtime disposal"
					? Layer.effectDiscard(Effect.addFinalizer(() => waiting))
					: Layer.empty
			);
			const application = createApplicationRuntime(runtime);
			await application.run(
				"startup",
				phase === "platform resources" ? Effect.addFinalizer(() => waiting) : Effect.void
			);
			const pending =
				phase === "drain" ? application.run("stuck mutation", waiting) : Promise.resolve();
			const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				const quitting = application.shutdown(20);
				expect(application.shutdown(20)).toBe(quitting);
				expect(await quitting).toBe("timeout");
				expect(diagnostic).toHaveBeenCalledWith("Application shutdown deadline exceeded", {
					deadlineMs: 20,
					phase,
					pending: phase === "drain" ? ["stuck mutation"] : [],
				});
				await expect(application.run("late", Effect.void)).rejects.toThrow("shutting down");
			} finally {
				release();
				await pending;
				await application.dispose();
				diagnostic.mockRestore();
			}
		});
	}

	it("continues cleanup after a failing platform finalizer and reports failure", async () => {
		let released = false;
		const runtime = ManagedRuntime.make(
			Layer.effectDiscard(
				Effect.addFinalizer(() =>
					Effect.sync(() => {
						released = true;
					})
				)
			)
		);
		const application = createApplicationRuntime(runtime);
		await application.run(
			"startup",
			Effect.addFinalizer(() => Effect.die("release failed"))
		);
		const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			expect(await application.shutdown()).toBe("failed");
			expect(released).toBe(true);
			expect(diagnostic).toHaveBeenCalledWith(
				"Application shutdown failed",
				expect.objectContaining({ error: expect.anything() })
			);
		} finally {
			diagnostic.mockRestore();
		}
	});
});
