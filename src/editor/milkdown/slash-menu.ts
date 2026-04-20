import type { Ctx } from '@milkdown/kit/ctx';
import { commandsCtx, prosePluginsCtx } from '@milkdown/kit/core';
import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { SlashProvider } from '@milkdown/kit/plugin/slash';
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
  headingSchema,
  hrSchema,
  orderedListSchema,
  paragraphSchema,
  setBlockTypeCommand,
  wrapInBlockTypeCommand,
} from '@milkdown/kit/preset/commonmark';

type SlashAction = {
  id: string;
  title: string;
  keywords: string[];
  run: (ctx: Ctx) => void;
};

const milkdownEvalSlashPluginKey = new PluginKey('ATOMIC_MILKDOWN_EVAL_SLASH');

function isSelectionAtEndOfNode(view: EditorView) {
  const { selection } = view.state;
  return selection.empty && selection.$from.parentOffset === selection.$from.parent.content.size;
}

function isInsideRestrictedBlock(view: EditorView) {
  for (let depth = view.state.selection.$from.depth; depth > 0; depth -= 1) {
    const node = view.state.selection.$from.node(depth);
    if (node.type.name === 'code_block') return true;
    if (node.type.name === 'bullet_list') return true;
    if (node.type.name === 'ordered_list') return true;
    if (node.type.name === 'list_item') return true;
  }
  return false;
}

function buildSlashActions(): SlashAction[] {
  return [
    {
      id: 'paragraph',
      title: 'Text',
      keywords: ['text', 'paragraph', 'body'],
      run: (ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(setBlockTypeCommand.key, {
          nodeType: paragraphSchema.type(ctx),
        });
      },
    },
    {
      id: 'h1',
      title: 'Heading 1',
      keywords: ['h1', 'heading 1', 'title'],
      run: (ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(setBlockTypeCommand.key, {
          nodeType: headingSchema.type(ctx),
          attrs: { level: 1 },
        });
      },
    },
    {
      id: 'h2',
      title: 'Heading 2',
      keywords: ['h2', 'heading 2', 'section'],
      run: (ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(setBlockTypeCommand.key, {
          nodeType: headingSchema.type(ctx),
          attrs: { level: 2 },
        });
      },
    },
    {
      id: 'h3',
      title: 'Heading 3',
      keywords: ['h3', 'heading 3', 'subsection'],
      run: (ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(setBlockTypeCommand.key, {
          nodeType: headingSchema.type(ctx),
          attrs: { level: 3 },
        });
      },
    },
    {
      id: 'bullet-list',
      title: 'Bullet List',
      keywords: ['bullet', 'list', 'ul'],
      run: (ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(wrapInBlockTypeCommand.key, {
          nodeType: bulletListSchema.type(ctx),
        });
      },
    },
    {
      id: 'ordered-list',
      title: 'Numbered List',
      keywords: ['numbered', 'ordered', 'list', 'ol'],
      run: (ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(wrapInBlockTypeCommand.key, {
          nodeType: orderedListSchema.type(ctx),
        });
      },
    },
    {
      id: 'blockquote',
      title: 'Quote',
      keywords: ['quote', 'blockquote', 'callout'],
      run: (ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(wrapInBlockTypeCommand.key, {
          nodeType: blockquoteSchema.type(ctx),
        });
      },
    },
    {
      id: 'code-block',
      title: 'Code Block',
      keywords: ['code', 'fence', 'snippet'],
      run: (ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(setBlockTypeCommand.key, {
          nodeType: codeBlockSchema.type(ctx),
        });
      },
    },
    {
      id: 'divider',
      title: 'Divider',
      keywords: ['divider', 'rule', 'hr'],
      run: (ctx) => {
        const commands = ctx.get(commandsCtx);
        commands.call(clearTextInCurrentBlockCommand.key);
        commands.call(addBlockTypeCommand.key, {
          nodeType: hrSchema.type(ctx),
        });
      },
    },
  ];
}

function matchesQuery(action: SlashAction, query: string) {
  if (!query) return true;
  const normalizedQuery = query.toLowerCase().trim();
  return [action.title, ...action.keywords].some((value) => value.toLowerCase().includes(normalizedQuery));
}

class MilkdownSlashMenuView {
  private readonly actions = buildSlashActions();
  private readonly content = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly provider: SlashProvider;
  private filteredActions = this.actions;
  private selectedIndex = 0;
  private visible = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly view: EditorView
  ) {
    this.content.className = 'pm-eval-slash-menu';
    this.content.dataset.show = 'false';
    this.list.className = 'pm-eval-slash-menu__list';
    this.content.appendChild(this.list);

    this.provider = new SlashProvider({
      content: this.content,
      debounce: 20,
      offset: 10,
      shouldShow: (view) => {
        if (isInsideRestrictedBlock(view)) return false;
        if (!isSelectionAtEndOfNode(view)) return false;

        const currentText = this.provider.getContent(
          view,
          (node: Node) => ['paragraph', 'heading'].includes(node.type.name)
        );

        if (!currentText || !currentText.startsWith('/')) return false;

        const query = currentText.slice(1).trim();
        this.filteredActions = this.actions.filter((action) => matchesQuery(action, query));
        this.selectedIndex = Math.min(this.selectedIndex, Math.max(this.filteredActions.length - 1, 0));
        this.renderMenu();
        return this.filteredActions.length > 0;
      },
    });

    this.provider.onShow = () => {
      this.visible = true;
      this.content.dataset.show = 'true';
    };

    this.provider.onHide = () => {
      this.visible = false;
      this.content.dataset.show = 'false';
    };

    this.view.dom.addEventListener('keydown', this.onKeyDown);
    this.renderMenu();
  }

  update(view: EditorView, prevState?: Parameters<SlashProvider['update']>[1]) {
    this.provider.update(view, prevState);
  }

  destroy() {
    this.view.dom.removeEventListener('keydown', this.onKeyDown);
    this.provider.destroy();
    this.content.remove();
  }

  private executeAction = (action: SlashAction) => {
    this.removeSlashQuery();
    action.run(this.ctx);
    this.provider.hide();
  };

  private removeSlashQuery() {
    const { state } = this.view;
    const { selection } = state;

    if (!selection.empty) return;

    const currentText = this.provider.getContent(
      this.view,
      (node: Node) => ['paragraph', 'heading'].includes(node.type.name)
    );

    if (!currentText || !currentText.startsWith('/')) return;

    const from = selection.$from.start();
    const to = selection.from;

    if (from >= to) return;

    this.view.dispatch(state.tr.delete(from, to));
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.visible || this.filteredActions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.filteredActions.length;
      this.renderMenu();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.filteredActions.length) % this.filteredActions.length;
      this.renderMenu();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.executeAction(this.filteredActions[this.selectedIndex]);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.provider.hide();
    }
  };

  private renderMenu() {
    this.list.replaceChildren();

    this.filteredActions.forEach((action, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pm-eval-slash-menu__item';
      button.dataset.selected = index === this.selectedIndex ? 'true' : 'false';

      const title = document.createElement('div');
      title.className = 'pm-eval-slash-menu__title';
      title.textContent = action.title;

      const hint = document.createElement('div');
      hint.className = 'pm-eval-slash-menu__hint';
      hint.textContent = `/${action.keywords[0]}`;

      button.append(title, hint);
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.executeAction(action);
      });

      this.list.appendChild(button);
    });
  }
}

export function installMilkdownSlashMenu(ctx: Ctx) {
  const plugin = new Plugin({
    key: milkdownEvalSlashPluginKey,
    view: (view) => {
      const menu = new MilkdownSlashMenuView(ctx, view);
      return {
        update(nextView, prevState) {
          menu.update(nextView, prevState);
        },
        destroy() {
          menu.destroy();
        },
      };
    },
  });

  ctx.update(prosePluginsCtx, (plugins) => plugins.concat(plugin));
}
