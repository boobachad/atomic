# Milkdown Development Guide

This is the short guide for building on the Milkdown evaluation surface in
Atomic.

It exists because Milkdown is not a "React editor component with props."
It is a plugin-driven editor runtime with a context graph, ProseMirror
plugins, and a markdown transformer pipeline. If we treat it like a normal
React widget, we will keep fighting the framework.

## Mental Model

Milkdown has three layers that matter for us:

1. **Editor composition**
   `Editor.make().config(...).use(...)`
2. **Context slices**
   `ctx.set(...)`, `ctx.get(...)`, `ctx.update(...)`
3. **Runtime plugins**
   ProseMirror plugins, listeners, commands, schemas, themes, slash/tooltip
   providers, node views

The important point is:

- React mounts the editor.
- Milkdown owns the editor runtime.
- ProseMirror owns document/view updates inside that runtime.

Do not try to recreate editor lifecycle in React state unless there is a
very strong reason.

## Core Building Blocks

### `Editor.make()`

This is the root of composition. We use it to:

- set root DOM and default markdown
- configure context slices
- register presets and plugins

Pattern:

```ts
Editor.make()
  .config((ctx) => {
    ctx.set(rootCtx, root)
    ctx.set(defaultValueCtx, markdown)
  })
  .use(commonmark)
  .use(gfm)
  .use(history)
  .use(listener)
```

### `Ctx`

Milkdown passes a context object through plugins and config functions.
This is how extension code communicates with the runtime.

Common slices we are using:

- `rootCtx`: root DOM container
- `defaultValueCtx`: initial markdown / doc input
- `editorViewCtx`: access the ProseMirror view
- `commandsCtx`: call registered commands
- `prosePluginsCtx`: add custom ProseMirror plugins
- `listenerCtx`: subscribe to editor events

Rule:

- Use `ctx.set(...)` during initial configuration.
- Use `ctx.update(...)` when extending existing arrays/objects such as
  `prosePluginsCtx` or `editorViewOptionsCtx`.

## React Integration

Use `@milkdown/react` only to mount and retrieve the editor instance.

Pattern:

```ts
const { get } = useEditor((root) =>
  Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdownSource)
    })
    .use(commonmark),
  [markdownSource]
)
```

Guidelines:

- Keep `useEditor(...)` dependencies narrow and deliberate.
- Do not push editor internals into React state unless the UI actually
  needs rerenders.
- For imperative editor actions like `focus`, `undo`, `redo`, prefer refs
  over parent state setters.
- Assume that recreating the editor is expensive and should be intentional.

## Commands

Milkdown command execution goes through `commandsCtx`.

Pattern:

```ts
editor.action((ctx) => {
  ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
    nodeType: headingSchema.type(ctx),
    attrs: { level: 2 },
  })
})
```

Use commands for structural transforms. Do not simulate those transforms by
manipulating DOM.

## Listener Plugin

If you want editor events like markdown updates, selection changes, focus,
or blur, use `@milkdown/kit/plugin/listener`.

Pattern:

```ts
ctx.get(listenerCtx)
  .markdownUpdated((_ctx, markdown) => { ... })
  .selectionUpdated((_ctx, selection) => { ... })
  .focus(() => { ... })
  .blur(() => { ... })
```

Important:

- `.use(listener)` must be present.
- Listeners are for observation and lightweight integration.
- Do not use listeners as a substitute for ProseMirror plugins when the
  behavior needs to participate in the editor update cycle.

## ProseMirror Plugins

This is the main lesson from the slash-menu work.

If a feature needs to update with every editor transaction or every view
update, install it as a **ProseMirror plugin** via `prosePluginsCtx`.

Pattern:

```ts
ctx.update(prosePluginsCtx, (plugins) =>
  plugins.concat(
    new Plugin({
      key: new PluginKey('MY_PLUGIN'),
      view: (view) => {
        const instance = new MyPluginView(ctx, view)
        return {
          update(nextView, prevState) {
            instance.update(nextView, prevState)
          },
          destroy() {
            instance.destroy()
          },
        }
      },
    })
  )
)
```

Use this for:

- slash menus
- tooltips
- floating UI tied to selection/cursor/view updates
- decorations that need transaction-aware updates
- custom event handling that depends on editor state

Do **not** use React effects or loose DOM listeners as the primary driver
for these features.

## Providers Like `SlashProvider`

`SlashProvider` is not a full plugin. It is a UI helper that still needs a
plugin/view layer to drive it.

What it does:

- decides visibility
- positions the element
- toggles `data-show`

What it does **not** do:

- automatically subscribe to editor transactions
- install itself into Milkdown
- provide its own CSS

So the correct pattern is:

1. create the provider inside a ProseMirror plugin view
2. call `provider.update(view, prevState)` from the plugin view `update`
3. destroy it from the plugin view `destroy`
4. provide CSS for visibility and positioning

## CSS Ownership

Milkdown is headless. Many UI helpers only toggle DOM attributes such as
`data-show`.

That means:

- if a menu is not styled, it may technically exist but still be invisible
- if overlay CSS is missing, positioning may be correct but still unusable
- if spacing and sizing are left generic, the UI will drift toward low-density
  demo chrome instead of production editor chrome

For provider-backed UI, always verify:

- root class names
- `data-show` contract
- absolute/fixed positioning
- z-index
- hidden state styling
- density: width, padding, text size, and row height should be deliberate

## Recommended Feature Pattern

When adding a new feature to the eval:

1. Decide which layer it belongs to:
   - React shell
   - listener integration
   - command wiring
   - ProseMirror plugin
   - node view
   - CSS/theme
2. Keep the first version narrow.
3. Verify it on both the fixture and a real atom.
4. Only then layer Atomic-specific behavior.

## What To Avoid

- Treating Milkdown as a normal controlled React input.
- Driving editor UI from parent React rerenders when refs or plugin state
  would do.
- Building transaction-sensitive UI without a ProseMirror plugin.
- Assuming provider/helper classes include their own runtime wiring.
- Assuming provider/helper classes include their own CSS.
- Recreating editor instances casually.

## Practical Rules For Atomic

- Structural editing features should go through commands.
- Transaction-aware UI should go through `prosePluginsCtx`.
- Markdown observation should go through `listenerCtx`.
- Imperative shell actions should use refs, not parent state churn.
- CSS for custom UI is our responsibility.
- Editor chrome should default toward compact, data-dense presentation unless
  there is a specific usability reason not to.
- If a Milkdown feature seems "almost working," check whether we are
  missing the plugin layer or the CSS layer before debugging deeper.

## Current Atomic Files To Look At

- [src/components/dev/ProsemirrorEval.tsx](/Users/kenny/git/atomic/src/components/dev/ProsemirrorEval.tsx)
- [src/editor/milkdown/slash-menu.ts](/Users/kenny/git/atomic/src/editor/milkdown/slash-menu.ts)
- [docs/milkdown-evaluation-roadmap.md](/Users/kenny/git/atomic/docs/milkdown-evaluation-roadmap.md)

## Short Version

If you remember only three things:

1. Milkdown features are usually installed through context, not props.
2. View-updated UI belongs in a ProseMirror plugin, not a React effect.
3. Provider helpers still need both runtime wiring and CSS from us.
