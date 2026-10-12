import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { effectValidator } from "./effect-validation";
import {
	createTodoRequestSchema,
	TodoCreationRequest,
	todoCreationFields,
	todoCreationIssues,
	TodoDate,
} from "./todo-creation";
import { TodoFileSchema } from "./todo";

const UUID = TodoCreationRequest.fields.scope;
const Revision = TodoCreationRequest.fields.revision;
const WorkspaceColor = Schema.Literals([
	"blue",
	"green",
	"amber",
	"red",
	"violet",
	"pink",
	"cyan",
	"orange",
]);
const TodoPath = Schema.String.check(
	Schema.makeFilter((value) =>
		value.trim().length > 0 ? undefined : "Choose the exact Todo file for this workspace."
	)
);
const WorkspaceName = Schema.String.pipe(
	Schema.decodeTo(
		Schema.String.check(
			Schema.makeFilter((value) => (value.length > 0 ? undefined : "Enter a workspace name."))
		),
		{ decode: SchemaGetter.trim(), encode: SchemaGetter.passthrough() }
	)
);
const CreatedAt = Schema.String.check(
	Schema.makeFilter((value) =>
		/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(
			value
		) && Schema.is(TodoDate)(value.slice(0, 10))
			? undefined
			: "Use an ISO datetime with a timezone."
	)
);
const WorkspaceSchema = Schema.Struct({
	id: UUID,
	name: Schema.NonEmptyString.check(Schema.isTrimmed()),
	color: WorkspaceColor,
	todo_path: TodoPath,
	created_at: CreatedAt,
});
const CatalogueSchema = Schema.Struct({
	version: Schema.Literal(1),
	active_workspace_id: Schema.NullOr(UUID),
	workspaces: Schema.mutable(Schema.Array(WorkspaceSchema)),
}).check(
	Schema.makeFilter((catalogue) => {
		const issues: string[] = [];
		for (const field of ["id", "name", "todo_path"] as const) {
			const values = catalogue.workspaces.map((workspace) =>
				field === "name" ? workspace.name.toLowerCase() : workspace[field]
			);
			if (new Set(values).size !== values.length) issues.push(`Duplicate Workspace ${field}`);
		}
		if (
			catalogue.active_workspace_id !== null &&
			!catalogue.workspaces.some((w) => w.id === catalogue.active_workspace_id)
		)
			issues.push("Active workspace is missing");
		return issues;
	})
);
export const workspaceSchema = effectValidator(WorkspaceSchema);
export const catalogueSchema = effectValidator(CatalogueSchema);
export { todoItemSchema, todoFileSchema } from "./todo";
export type { TodoFile } from "./todo";
export type Catalogue = typeof CatalogueSchema.Type;
export const WorkspaceCreationRequest = Schema.Struct({
	name: Schema.mutableKey(WorkspaceName),
	color: Schema.mutableKey(WorkspaceColor),
	todoPath: Schema.mutableKey(TodoPath),
});
export const createWorkspaceRequestSchema = effectValidator(WorkspaceCreationRequest);
const SessionSchema = Schema.Union([
	Schema.Struct({
		status: Schema.Literal("ready"),
		catalogue: CatalogueSchema,
		todo_file: TodoFileSchema,
	}),
	Schema.Struct({
		status: Schema.Literal("empty"),
		catalogue: CatalogueSchema,
		warning: Schema.NullOr(Schema.String),
	}),
	Schema.Struct({ status: Schema.Literal("unavailable"), error: Schema.NonEmptyString }),
]).check(
	Schema.makeFilter((session) => {
		if (session.status !== "ready") return;
		const active = session.catalogue.workspaces.find(
			(w) => w.id === session.catalogue.active_workspace_id
		);
		return !active || active.todo_path !== session.todo_file.path
			? "Loaded Todo file must belong to the Active workspace"
			: undefined;
	})
);
export const sessionSchema = effectValidator(SessionSchema);
const ConfirmedSessionSchema = Schema.Struct({
	scope: UUID,
	revision: Revision,
	session: SessionSchema,
});
export const confirmedSessionSchema = effectValidator(ConfirmedSessionSchema);
export type ConfirmedSession = typeof ConfirmedSessionSchema.Type;
const Rejected = Schema.Struct({
	status: Schema.Literal("rejected"),
	message: Schema.NonEmptyString,
});
export const sessionOutcomeSchema = effectValidator(
	Schema.Union([
		Schema.Struct({ status: Schema.Literal("applied"), confirmed: ConfirmedSessionSchema }),
		Rejected,
	])
);
export const switchWorkspaceRequestSchema = effectValidator(Schema.Struct({ workspaceId: UUID }));
export const deleteWorkspaceRequestSchema = switchWorkspaceRequestSchema;
const TodoMutationRequest = Schema.Struct({
	scope: UUID,
	revision: Revision,
	workspaceId: UUID,
	lineNumber: Schema.Int.check(Schema.isGreaterThan(0)),
	expectedRaw: Schema.String,
});
export const todoMutationRequestSchema = effectValidator(TodoMutationRequest);
const ConfirmedTodoSchema = Schema.Struct({
	scope: Schema.mutableKey(UUID),
	revision: Schema.mutableKey(Revision),
	workspaceId: Schema.mutableKey(UUID),
	todo_file: TodoFileSchema,
});
export const confirmedTodoSchema = effectValidator(ConfirmedTodoSchema);
export type ConfirmedTodo = typeof ConfirmedTodoSchema.Type;
export const todoOutcomeSchema = effectValidator(
	Schema.Union([
		Schema.Struct({ status: Schema.Literal("applied"), confirmed: ConfirmedTodoSchema }),
		Schema.Struct({
			status: Schema.Literal("conflict"),
			confirmed: ConfirmedTodoSchema,
			message: Schema.NonEmptyString,
		}),
		Rejected,
	])
);
export const setTodoCompletionRequestSchema = effectValidator(
	Schema.Struct({ ...TodoMutationRequest.fields, completed: Schema.Boolean })
);
export {
	createTodoRequestSchema,
	normalizeTodoDescription,
	todoTagSchema,
	todoDateSchema,
	todoMetadataSchema,
} from "./todo-creation";
export const editTodoRequestSchema = effectValidator(
	Schema.Struct({
		...TodoMutationRequest.fields,
		...todoCreationFields,
		creationDate: Schema.NullOr(TodoDate),
		completed: Schema.Boolean,
	}).check(Schema.makeFilter((input) => todoCreationIssues(input, true)))
);
export const reorderTodoRequestSchema = effectValidator(
	Schema.Struct({
		scope: UUID,
		revision: Revision,
		workspaceId: UUID,
		lineNumbers: Schema.mutable(Schema.Array(TodoMutationRequest.fields.lineNumber)).check(
			Schema.isMinLength(2),
			Schema.makeFilter((values) =>
				new Set(values).size === values.length ? undefined : "Todo item positions must be unique"
			)
		),
	})
);
const emptyRequestSchema = effectValidator(Schema.Record(Schema.String, Schema.Never));
export const desktopContract = {
	editTodo: {
		channel: "tuxedo:edit-todo",
		request: editTodoRequestSchema,
		response: todoOutcomeSchema,
	},
	reorderTodo: {
		channel: "tuxedo:reorder-todo",
		request: reorderTodoRequestSchema,
		response: todoOutcomeSchema,
	},
	deleteWorkspace: {
		channel: "tuxedo:delete-workspace",
		request: deleteWorkspaceRequestSchema,
		response: sessionOutcomeSchema,
	},
	setTodoCompletion: {
		channel: "tuxedo:set-todo-completion",
		request: setTodoCompletionRequestSchema,
		response: todoOutcomeSchema,
	},
	deleteTodo: {
		channel: "tuxedo:delete-todo",
		request: todoMutationRequestSchema,
		response: todoOutcomeSchema,
	},
	createTodo: {
		channel: "tuxedo:create-todo",
		request: createTodoRequestSchema,
		response: todoOutcomeSchema,
	},
	switchWorkspace: {
		channel: "tuxedo:switch-workspace",
		request: switchWorkspaceRequestSchema,
		response: sessionOutcomeSchema,
	},
	selectTodoFile: {
		channel: "tuxedo:select-todo-file",
		request: emptyRequestSchema,
		response: effectValidator(Schema.NullOr(Schema.NonEmptyString)),
	},
	createWorkspace: {
		channel: "tuxedo:create-workspace",
		request: createWorkspaceRequestSchema,
		response: sessionOutcomeSchema,
	},
	readSession: {
		channel: "tuxedo:read-session",
		request: emptyRequestSchema,
		response: confirmedSessionSchema,
	},
	restoreSession: {
		channel: "tuxedo:restore-session",
		request: emptyRequestSchema,
		response: confirmedSessionSchema,
	},
} as const;
export type DesktopOperation = keyof typeof desktopContract;
export type DesktopRequest<K extends DesktopOperation> = ReturnType<
	(typeof desktopContract)[K]["request"]["parse"]
>;
export type DesktopResponse<K extends DesktopOperation> = ReturnType<
	(typeof desktopContract)[K]["response"]["parse"]
>;
export type DesktopAPI = {
	[K in DesktopOperation]: (request: DesktopRequest<K>) => Promise<DesktopResponse<K>>;
};
export const todoFileChangeEvent = {
	channel: "tuxedo:todo-file-changed",
	payload: effectValidator(
		Schema.Struct({
			scope: TodoCreationRequest.fields.scope,
			revision: TodoCreationRequest.fields.revision,
			workspaceId: TodoCreationRequest.fields.workspaceId,
			todoPath: Schema.NonEmptyString,
		})
	),
} as const;
export type TodoFileChange = ReturnType<typeof todoFileChangeEvent.payload.parse>;
export type TodoFileObservation = {
	onTodoFileChanged: (listener: (event: TodoFileChange) => void) => () => void;
};
export function createDesktopClient(
	invoke: (channel: string, request: unknown) => Promise<unknown>
): DesktopAPI {
	const call = async <K extends DesktopOperation>(
		operation: K,
		request: DesktopRequest<K>
	): Promise<DesktopResponse<K>> => {
		const contract = desktopContract[operation];
		return contract.response.parse(
			await invoke(contract.channel, contract.request.parse(request))
		) as DesktopResponse<K>;
	};
	return {
		editTodo: (request) => call("editTodo", request),
		reorderTodo: (request) => call("reorderTodo", request),
		deleteWorkspace: (request) => call("deleteWorkspace", request),
		setTodoCompletion: (request) => call("setTodoCompletion", request),
		deleteTodo: (request) => call("deleteTodo", request),
		createTodo: (request) => call("createTodo", request),
		switchWorkspace: (request) => call("switchWorkspace", request),
		selectTodoFile: (request) => call("selectTodoFile", request),
		createWorkspace: (request) => call("createWorkspace", request),
		readSession: (request) => call("readSession", request),
		restoreSession: (request) => call("restoreSession", request),
	};
}
declare global {
	interface Window {
		desktop: DesktopAPI & TodoFileObservation;
	}
}
