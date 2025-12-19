# MagicGrid workflow

MagicGrid is a layout-driven workspace that pairs a gridded canvas with a palette of reusable regions and a set of constraints that keep those regions aligned. Use the existing development commands from the [README](../README.md#getting-started) to run the API (`pnpm --filter @cameotest/server dev`) and client (`pnpm --filter @cameotest/client dev`), then open the **MagicGrid editor** shell in the browser.

## Typical workflow

1. Select a workspace from the toolbar dropdown. If none exist, the client will bootstrap one and open it automatically.
2. Use **New workspace**, **Duplicate**, and **Delete** for lifecycle actions; the toolbar status text reflects progress for each call.
3. Toggle **Autosave** (on by default) to queue a save 1.5s after any change. Manual **Save** stays available and is disabled while a save is in flight.
4. Add elements from the **Palette** via **Add to grid**; the new element is selected immediately so you can refine its properties.
5. Adjust layout values (rows, columns, gaps) or element fields in the right-hand **Properties** panel. Each change marks the workspace dirty and feeds the autosave timer.
6. Use **Undo** / **Redo** in the toolbar to step through the MagicGrid history stack. Both buttons enable only when a corresponding action is available.

## Default elements

The initial MagicGrid workspace seeds five regions, each tagged with a suggested layout role:

- **Header** (`row:0`, `column:0`, `rowSpan:1`, `columnSpan:12`, layer: `content`, notes: “Spans the full width of the layout.”)
- **Sidebar** (`row:1`, `column:0`, `rowSpan:10`, `columnSpan:3`, layer: `content`, notes: “Navigation and filters.”)
- **Content** (`row:1`, `column:3`, `rowSpan:8`, `columnSpan:9`, layer: `content`, notes: “Primary working canvas.”)
- **Inspector** (`row:9`, `column:9`, `rowSpan:2`, `columnSpan:3`, layer: `overlay`, notes: “Contextual properties.”)
- **Footer** (`row:11`, `column:0`, `rowSpan:1`, `columnSpan:12`, layer: `background`, notes: “Status and links.”)

Adding a palette item clones its template with a new identifier and timestamps so you can reposition or edit it independently.

## Default constraints

MagicGrid applies four constraints to keep the starter layout cohesive:

- **Left rail**: alignment (axis `column`, track `0`) for the Header and Sidebar.
- **Right rail**: alignment (axis `column`, track `12`, strength `required`) for the Header and Content.
- **Content row spacing**: spacing (axis `row`, gap `12`) between the Sidebar and Content.
- **Inspector dock**: lock (anchor `padding`, offset right `12`, bottom `12`) pinning the Inspector to the padded edge.

Constraints update automatically when elements are removed and can be reviewed in the **Constraints** panel in the properties column.
