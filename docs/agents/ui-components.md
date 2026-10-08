# UI components, shadcn, and forms

- Use a shadcn-svelte primitive (Dialog, Button, Input, Label, form controls, ...) whenever one fits. Add missing ones with the shadcn-svelte CLI; generated primitives live in `src/lib/shared/ui`.
- Feature components are domain-specific and live in their module's `ui/` folder (`src/lib/modules/<name>/ui`), composing shared primitives.
- Style with Tailwind utilities, including responsive and dark-mode variants; reserve `<style>` blocks for what Tailwind cannot express.
- Build client-side forms from shadcn-svelte `Form` primitives, Formsnap, Superforms, and a Zod schema, composed as `Form.Field` → `Form.Control` → input → `Form.Description` / `Form.FieldErrors` so labels and ARIA validation stay connected.
- Client-side validation serves responsiveness; the Rust command boundary re-validates everything security- or persistence-related.
- Keep the `components.json` aliases (`components: $lib/shared`, `utils: $lib/shared/utils`, `ui: $lib/shared/ui`, `hooks: $lib/shared/hooks`, `lib: $lib`); the CLI places generated files by them.
