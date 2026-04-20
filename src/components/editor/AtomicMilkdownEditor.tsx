import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Bold, Code2, Italic, Link2 } from 'lucide-react';
import { Crepe } from '@milkdown/crepe';
import type { CrepeConfig } from '@milkdown/crepe';
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core';
import {
  emphasisSchema,
  inlineCodeSchema,
  isMarkSelectedCommand,
  linkSchema,
  strongSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
} from '@milkdown/kit/preset/commonmark';
import { NodeSelection, TextSelection } from '@milkdown/prose/state';
import { redo, undo } from '@milkdown/prose/history';
import '@milkdown/crepe/theme/common/style.css';
import '../../styles/crepe-atomic-theme.css';
import { withAtomicImageConfig } from '../../editor/milkdown/crepe-config';

type SelectionToolbarState = {
  visible: boolean;
  left: number;
  top: number;
  bold: boolean;
  italic: boolean;
  code: boolean;
  link: boolean;
};

type LinkPopoverState = {
  visible: boolean;
  left: number;
  top: number;
  href: string;
  label: string;
  from: number;
  to: number;
  hasExistingLink: boolean;
};

type ImagePopoverState = {
  visible: boolean;
  left: number;
  top: number;
  src: string;
};

const HIDDEN_SELECTION_TOOLBAR: SelectionToolbarState = {
  visible: false,
  left: 0,
  top: 0,
  bold: false,
  italic: false,
  code: false,
  link: false,
};

const HIDDEN_LINK_POPOVER: LinkPopoverState = {
  visible: false,
  left: 0,
  top: 0,
  href: '',
  label: '',
  from: 0,
  to: 0,
  hasExistingLink: false,
};

const HIDDEN_IMAGE_POPOVER: ImagePopoverState = {
  visible: false,
  left: 0,
  top: 0,
  src: '',
};

function AtomicSelectionToolbar({
  state,
  showLinkAction,
  onToggleBold,
  onToggleItalic,
  onToggleCode,
  onToggleLink,
}: {
  state: SelectionToolbarState;
  showLinkAction: boolean;
  onToggleBold: () => void;
  onToggleItalic: () => void;
  onToggleCode: () => void;
  onToggleLink: () => void;
}) {
  if (!state.visible) return null;

  const items = [
    { key: 'bold', active: state.bold, icon: Bold, label: 'Bold', onClick: onToggleBold },
    { key: 'italic', active: state.italic, icon: Italic, label: 'Italic', onClick: onToggleItalic },
    { key: 'code', active: state.code, icon: Code2, label: 'Inline code', onClick: onToggleCode },
    ...(showLinkAction
      ? [{ key: 'link', active: state.link, icon: Link2, label: 'Link', onClick: onToggleLink }]
      : []),
  ] as const;

  return (
    <div
      className="pm-eval-selection-toolbar"
      style={{
        left: `${state.left}px`,
        top: `${state.top}px`,
      }}
    >
      {items.map(({ key, active, icon: Icon, label, onClick }) => (
        <button
          key={key}
          type="button"
          className={`pm-eval-selection-toolbar__item${active ? ' is-active' : ''}`}
          title={label}
          aria-label={label}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onClick}
        >
          <Icon size={16} strokeWidth={2.2} />
        </button>
      ))}
    </div>
  );
}

function AtomicLinkPopover({
  state,
  onHrefChange,
  onLabelChange,
  onRemove,
}: {
  state: LinkPopoverState;
  onHrefChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onRemove: () => void;
}) {
  if (!state.visible) return null;

  return (
    <div
      className="pm-eval-link-popover"
      style={{
        left: `${state.left}px`,
        top: `${state.top}px`,
      }}
    >
      <input
        autoFocus
        value={state.href}
        onChange={(event) => onHrefChange(event.target.value)}
        placeholder="URL"
        className="pm-eval-link-popover__input"
      />
      <input
        value={state.label}
        onChange={(event) => onLabelChange(event.target.value)}
        placeholder="Label"
        className="pm-eval-link-popover__input"
      />
      {state.hasExistingLink && (
        <div className="pm-eval-link-popover__actions">
          <button
            type="button"
            className="pm-eval-link-popover__text-action"
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function AtomicImagePopover({
  state,
  onOpen,
  onCopyUrl,
}: {
  state: ImagePopoverState;
  onOpen: () => void;
  onCopyUrl: () => void;
}) {
  if (!state.visible) return null;

  return (
    <div
      className="pm-eval-image-popover"
      style={{
        left: `${state.left}px`,
        top: `${state.top}px`,
      }}
    >
      <button type="button" className="pm-eval-image-popover__action" onClick={onOpen}>
        Open image
      </button>
      <button type="button" className="pm-eval-image-popover__action" onClick={onCopyUrl}>
        Copy URL
      </button>
    </div>
  );
}

type AtomicMilkdownEditorInnerProps = {
  documentId?: string;
  markdownSource: string;
  crepeConfig?: CrepeConfig;
  blurEditorOnMount?: boolean;
  onMarkdownChange?: (markdown: string) => void;
  editorHandleRef?: MutableRefObject<AtomicMilkdownEditorHandle | null>;
};

export interface AtomicMilkdownEditorHandle {
  focus: () => void;
  undo: () => void;
  redo: () => void;
  getMarkdown: () => string;
  getContentDOM: () => HTMLElement | null;
}

export type AtomicMilkdownEditorProps = AtomicMilkdownEditorInnerProps;

export function AtomicMilkdownEditor({
  markdownSource,
  documentId,
  crepeConfig,
  blurEditorOnMount = false,
  onMarkdownChange,
  editorHandleRef,
}: AtomicMilkdownEditorProps) {
  const LINK_ICON_HIT_AREA_PX = 16;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const isReadyRef = useRef(false);
  const hasUserEditRef = useRef(false);
  const lastEmittedMarkdownRef = useRef(markdownSource);
  const onMarkdownChangeRef = useRef(onMarkdownChange);
  const [isReady, setIsReady] = useState(false);
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState>(
    HIDDEN_SELECTION_TOOLBAR
  );
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState>(HIDDEN_LINK_POPOVER);
  const [imagePopover, setImagePopover] = useState<ImagePopoverState>(HIDDEN_IMAGE_POPOVER);

  const effectiveCrepeConfig = useMemo(() => withAtomicImageConfig(crepeConfig), [crepeConfig]);
  const editorIdentity = documentId ?? markdownSource;
  const useAtomicToolbar = crepeConfig?.features?.[Crepe.Feature.Toolbar] === false;
  const showLinkAction =
    useAtomicToolbar || crepeConfig?.features?.[Crepe.Feature.LinkTooltip] !== false;
  const useAtomicLinkPopover =
    useAtomicToolbar && crepeConfig?.features?.[Crepe.Feature.LinkTooltip] === false;

  useEffect(() => {
    lastEmittedMarkdownRef.current = markdownSource;
    hasUserEditRef.current = false;
  }, [markdownSource]);

  useEffect(() => {
    onMarkdownChangeRef.current = onMarkdownChange;
  }, [onMarkdownChange]);

  const runEditorAction = useCallback(<T,>(runner: (crepe: Crepe) => T): T | null => {
    const crepe = crepeRef.current;
    if (!crepe || !isReadyRef.current) {
      return null;
    }
    return runner(crepe);
  }, []);

  const markUserEdit = useCallback(() => {
    hasUserEditRef.current = true;
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    let cancelled = false;
    const crepe = new Crepe({
      root: mount,
      defaultValue: markdownSource,
      ...effectiveCrepeConfig,
    });

    crepe.on((listeners) => {
      listeners.markdownUpdated((_, markdown) => {
        if (!hasUserEditRef.current) {
          lastEmittedMarkdownRef.current = markdown;
          return;
        }
        if (markdown === lastEmittedMarkdownRef.current) {
          return;
        }
        lastEmittedMarkdownRef.current = markdown;
        onMarkdownChangeRef.current?.(markdown);
      });
    });

    crepeRef.current = crepe;
    isReadyRef.current = false;
    hasUserEditRef.current = false;
    setIsReady(false);
    setSelectionToolbar(HIDDEN_SELECTION_TOOLBAR);
    setLinkPopover(HIDDEN_LINK_POPOVER);
    setImagePopover(HIDDEN_IMAGE_POPOVER);

    void crepe.create().then(() => {
      if (cancelled) {
        return;
      }

      isReadyRef.current = true;
      setIsReady(true);

      if (blurEditorOnMount) {
        const root = rootRef.current;
        if (root) {
          let scrubActive = true;

          const stopScrubbing = () => {
            scrubActive = false;
          };

          const scrubFocus = () => {
            if (cancelled || !scrubActive) return;
            const active = document.activeElement;
            if (!(active instanceof HTMLElement)) return;
            if (!root.contains(active)) return;

            const proseMirror =
              active.classList.contains('ProseMirror')
                ? active
                : active.closest('.ProseMirror');

            if (proseMirror instanceof HTMLElement) {
              proseMirror.blur();
            }
          };

          const intervalId = window.setInterval(scrubFocus, 50);
          const timeoutId = window.setTimeout(() => {
            stopScrubbing();
            window.clearInterval(intervalId);
          }, 2000);

          const stopEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'beforeinput'];
          stopEvents.forEach((eventName) => {
            window.addEventListener(eventName, stopScrubbing, { once: true, capture: true });
          });

          window.setTimeout(scrubFocus, 0);
          window.setTimeout(scrubFocus, 100);
          window.setTimeout(scrubFocus, 250);
          window.setTimeout(scrubFocus, 500);
          window.setTimeout(scrubFocus, 1000);

          const cleanupScrubber = () => {
            stopScrubbing();
            window.clearInterval(intervalId);
            window.clearTimeout(timeoutId);
            stopEvents.forEach((eventName) => {
              window.removeEventListener(eventName, stopScrubbing, true);
            });
          };

          if (cancelled) {
            cleanupScrubber();
          } else {
            window.addEventListener('pagehide', cleanupScrubber, { once: true });
          }
        }
      }

    });

    return () => {
      cancelled = true;
      isReadyRef.current = false;
      setIsReady(false);
      setSelectionToolbar(HIDDEN_SELECTION_TOOLBAR);
      setLinkPopover(HIDDEN_LINK_POPOVER);
      setImagePopover(HIDDEN_IMAGE_POPOVER);
      crepeRef.current = null;
      void crepe.destroy();
    };
  }, [blurEditorOnMount, editorIdentity, effectiveCrepeConfig]);

  useEffect(() => {
    if (!editorHandleRef) {
      return;
    }

    editorHandleRef.current = {
      focus: () => {
        void runEditorAction((crepe) => {
          crepe.editor.action((ctx) => {
            ctx.get(editorViewCtx).focus();
          });
        });
      },
      undo: () => {
        void runEditorAction((crepe) => {
          crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            undo(view.state, view.dispatch);
          });
        });
      },
      redo: () => {
        void runEditorAction((crepe) => {
          crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            redo(view.state, view.dispatch);
          });
        });
      },
      getMarkdown: () => runEditorAction((crepe) => crepe.getMarkdown()) ?? '',
      getContentDOM: () => rootRef.current?.querySelector('.ProseMirror') as HTMLElement | null,
    };

    return () => {
      editorHandleRef.current = null;
    };
  }, [editorHandleRef, runEditorAction]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || !isReady) return;

    const handleUserEdit = () => {
      hasUserEditRef.current = true;
    };

    element.addEventListener('beforeinput', handleUserEdit, true);
    element.addEventListener('paste', handleUserEdit, true);
    element.addEventListener('drop', handleUserEdit, true);
    element.addEventListener('cut', handleUserEdit, true);
    element.addEventListener('compositionend', handleUserEdit, true);

    return () => {
      element.removeEventListener('beforeinput', handleUserEdit, true);
      element.removeEventListener('paste', handleUserEdit, true);
      element.removeEventListener('drop', handleUserEdit, true);
      element.removeEventListener('cut', handleUserEdit, true);
      element.removeEventListener('compositionend', handleUserEdit, true);
    };
  }, [isReady]);

  useEffect(() => {
    if (!useAtomicToolbar) {
      setSelectionToolbar(HIDDEN_SELECTION_TOOLBAR);
      setLinkPopover(HIDDEN_LINK_POPOVER);
      setImagePopover(HIDDEN_IMAGE_POPOVER);
      return;
    }

    const element = rootRef.current;
    if (!element || !isReady) return;

    const updateSelectionToolbar = () => {
      const result = runEditorAction((crepe) =>
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (!(view.state.selection instanceof TextSelection) || view.state.selection.empty) {
            return HIDDEN_SELECTION_TOOLBAR;
          }

          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return HIDDEN_SELECTION_TOOLBAR;
          }

          const { anchorNode, focusNode } = selection;
          if (
            !anchorNode ||
            !focusNode ||
            !element.contains(anchorNode) ||
            !element.contains(focusNode)
          ) {
            return HIDDEN_SELECTION_TOOLBAR;
          }

          const range = selection.getRangeAt(0);
          const rangeRect = range.getBoundingClientRect();
          if (!rangeRect.width && !rangeRect.height) {
            return HIDDEN_SELECTION_TOOLBAR;
          }

          const rootRect = element.getBoundingClientRect();
          const commands = ctx.get(commandsCtx);
          return {
            visible: true,
            left: rangeRect.left - rootRect.left + rangeRect.width / 2,
            top: rangeRect.top - rootRect.top - 12,
            bold: commands.call(isMarkSelectedCommand.key, strongSchema.type(ctx)),
            italic: commands.call(isMarkSelectedCommand.key, emphasisSchema.type(ctx)),
            code: commands.call(isMarkSelectedCommand.key, inlineCodeSchema.type(ctx)),
            link: commands.call(isMarkSelectedCommand.key, linkSchema.type(ctx)),
          } satisfies SelectionToolbarState;
        })
      );

      setSelectionToolbar(result ?? HIDDEN_SELECTION_TOOLBAR);
    };

    const scheduleUpdate = () => {
      window.requestAnimationFrame(updateSelectionToolbar);
    };

    document.addEventListener('selectionchange', scheduleUpdate);
    element.addEventListener('pointerup', scheduleUpdate);
    element.addEventListener('keyup', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);
    element.addEventListener('scroll', scheduleUpdate, true);

    scheduleUpdate();

    return () => {
      document.removeEventListener('selectionchange', scheduleUpdate);
      element.removeEventListener('pointerup', scheduleUpdate);
      element.removeEventListener('keyup', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      element.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [isReady, runEditorAction, useAtomicToolbar]);

  useEffect(() => {
    if (!useAtomicToolbar) {
      setImagePopover(HIDDEN_IMAGE_POPOVER);
      return;
    }

    const element = rootRef.current;
    if (!element || !isReady) return;

    const updateImagePopover = () => {
      const result = runEditorAction((crepe) =>
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const selection = view.state.selection;
          if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image-block') {
            return HIDDEN_IMAGE_POPOVER;
          }

          const domNode = view.nodeDOM(selection.from);
          if (!(domNode instanceof HTMLElement) || !element.contains(domNode)) {
            return HIDDEN_IMAGE_POPOVER;
          }

          const rect = domNode.getBoundingClientRect();
          if (!rect.width && !rect.height) {
            return HIDDEN_IMAGE_POPOVER;
          }

          const rootRect = element.getBoundingClientRect();
          return {
            visible: true,
            left: rect.left - rootRect.left + rect.width / 2,
            top: rect.bottom - rootRect.top + 12,
            src: String(selection.node.attrs.src ?? ''),
          } satisfies ImagePopoverState;
        })
      );

      setImagePopover(result ?? HIDDEN_IMAGE_POPOVER);
    };

    const scheduleUpdate = () => {
      window.requestAnimationFrame(updateImagePopover);
    };

    document.addEventListener('selectionchange', scheduleUpdate);
    element.addEventListener('pointerup', scheduleUpdate);
    element.addEventListener('keyup', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);
    element.addEventListener('scroll', scheduleUpdate, true);

    scheduleUpdate();

    return () => {
      document.removeEventListener('selectionchange', scheduleUpdate);
      element.removeEventListener('pointerup', scheduleUpdate);
      element.removeEventListener('keyup', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      element.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [isReady, runEditorAction, useAtomicToolbar]);

  useEffect(() => {
    if (!useAtomicToolbar || !useAtomicLinkPopover) return;

    const element = rootRef.current;
    if (!element || !isReady) return;

    const findLinkSelection = (overrideSelection?: { from: number; to: number }) =>
      runEditorAction((crepe) =>
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const state = view.state;
          const selection = overrideSelection ?? state.selection;
          const isEmpty = overrideSelection
            ? overrideSelection.from === overrideSelection.to
            : state.selection.empty;
          const markType = linkSchema.type(ctx);

          let href = '';
          let start = selection.from;
          let end = selection.to;
          let found = false;

          state.doc.nodesBetween(
            selection.from,
            isEmpty ? selection.to + 1 : selection.to,
            (node, pos) => {
              if (!node.isText) return;
              const mark = node.marks.find(({ type }) => type === markType);
              if (!mark) return;
              if (!found) {
                href = String(mark.attrs.href ?? '');
                start = pos;
                found = true;
              }
              end = pos + node.nodeSize;
            }
          );

          const label = state.doc.textBetween(start, end);
          if (!found && isEmpty) return null;

          return {
            from: start,
            to: end,
            href,
            label,
            hasExistingLink: found,
          };
        })
      );

    const openLinkPopover = (
      rect: DOMRect,
      overrideSelection?: { from: number; to: number },
      fallback?: { href?: string; label?: string }
    ) => {
      const info = findLinkSelection(overrideSelection);
      if (!info) return;

      const rootRect = element.getBoundingClientRect();
      setLinkPopover({
        visible: true,
        left: rect.left - rootRect.left + rect.width / 2,
        top: rect.bottom - rootRect.top + 12,
        href: info.href || fallback?.href || '',
        label: info.label || fallback?.label || '',
        from: info.from,
        to: info.to,
        hasExistingLink: info.hasExistingLink,
      });
    };

    const handleLinkClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest('a[href]');
      if (!anchor || !element.contains(anchor)) return;

      const rect = anchor.getBoundingClientRect();
      const clickedIconArea = event.clientX >= rect.right - LINK_ICON_HIT_AREA_PX;
      event.preventDefault();
      event.stopPropagation();

      if (clickedIconArea) {
        const href = anchor.getAttribute('href')?.trim();
        if (!href) return;
        window.open(href, '_blank', 'noopener,noreferrer');
        return;
      }

      void runEditorAction((crepe) =>
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const start = view.posAtDOM(anchor, 0);
          const end = start + (anchor.textContent?.length ?? 0);
          view.dispatch(
            view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)).scrollIntoView()
          );
          openLinkPopover(rect, { from: start, to: end }, {
            href: anchor.getAttribute('href') ?? '',
            label: anchor.textContent ?? '',
          });
        })
      );
    };

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (!linkPopover.visible) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target instanceof Element && target.closest('.pm-eval-link-popover')) {
        return;
      }
      setLinkPopover(HIDDEN_LINK_POPOVER);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLinkPopover(HIDDEN_LINK_POPOVER);
      }
    };

    element.addEventListener('click', handleLinkClick, true);
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      element.removeEventListener('click', handleLinkClick, true);
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [LINK_ICON_HIT_AREA_PX, isReady, linkPopover.visible, runEditorAction, useAtomicLinkPopover, useAtomicToolbar]);

  const runMarkCommand = useCallback(
    (runner: (crepe: Crepe) => void) => {
      markUserEdit();
      const didRun = runEditorAction((crepe) => {
        runner(crepe);
      });
      if (didRun === null) return;

      window.requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          setSelectionToolbar(HIDDEN_SELECTION_TOOLBAR);
        }
      });
    },
    [markUserEdit, runEditorAction]
  );

  const handleToggleBold = useCallback(() => {
    runMarkCommand((crepe) => {
      crepe.editor.action((ctx) => {
        ctx.get(commandsCtx).call(toggleStrongCommand.key);
      });
    });
  }, [runMarkCommand]);

  const handleToggleItalic = useCallback(() => {
    runMarkCommand((crepe) => {
      crepe.editor.action((ctx) => {
        ctx.get(commandsCtx).call(toggleEmphasisCommand.key);
      });
    });
  }, [runMarkCommand]);

  const handleToggleCode = useCallback(() => {
    runMarkCommand((crepe) => {
      crepe.editor.action((ctx) => {
        ctx.get(commandsCtx).call(toggleInlineCodeCommand.key);
      });
    });
  }, [runMarkCommand]);

  const handleToggleLink = useCallback(() => {
    if (!useAtomicLinkPopover) {
      runMarkCommand((crepe) => {
        crepe.editor.action((ctx) => {
          ctx.get(commandsCtx).call(toggleLinkCommand.key);
        });
      });
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const rangeRect = selection.getRangeAt(0).getBoundingClientRect();
    const selectedAnchor =
      selection.anchorNode instanceof Element
        ? selection.anchorNode.closest('a[href]')
        : selection.anchorNode?.parentElement?.closest('a[href]');

    const element = rootRef.current;
    if (!element) return;

    const info = runEditorAction((crepe) =>
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const state = view.state;
        const selectionRange = state.selection;
        const markType = linkSchema.type(ctx);

        let href = '';
        let start = selectionRange.from;
        let end = selectionRange.to;
        let found = false;

        state.doc.nodesBetween(
          selectionRange.from,
          selectionRange.empty ? selectionRange.to + 1 : selectionRange.to,
          (node, pos) => {
            if (!node.isText) return;
            const mark = node.marks.find(({ type }) => type === markType);
            if (!mark) return;
            if (!found) {
              href = String(mark.attrs.href ?? '');
              start = pos;
              found = true;
            }
            end = pos + node.nodeSize;
          }
        );

        if (!found && selectionRange.empty) return null;

        return {
          from: start,
          to: end,
          href,
          label: state.doc.textBetween(start, end),
          hasExistingLink: found,
        };
      })
    );

    if (!info) return;

    const rootRect = element.getBoundingClientRect();
    setLinkPopover({
      visible: true,
      left: rangeRect.left - rootRect.left + rangeRect.width / 2,
      top: rangeRect.bottom - rootRect.top + 12,
      href: info.href || selectedAnchor?.getAttribute('href') || '',
      label: info.label || selectedAnchor?.textContent || '',
      from: info.from,
      to: info.to,
      hasExistingLink: info.hasExistingLink,
    });
  }, [runEditorAction, runMarkCommand, useAtomicLinkPopover]);

  const applyLinkState = useCallback(
    (draft: LinkPopoverState) => {
      if (!draft.visible) return draft;
      markUserEdit();

      const next = runEditorAction((crepe) =>
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const href = draft.href.trim();
          const labelText = draft.label.trim() || href;
          if (!href || !labelText) return draft;

          const linkMark = linkSchema.type(ctx).create({ href, title: null });
          const textNode = state.schema.text(labelText, [linkMark]);

          let tr = state.tr.replaceWith(draft.from, draft.to, textNode);
          tr = tr.setSelection(TextSelection.create(tr.doc, draft.from, draft.from + labelText.length));
          view.dispatch(tr.scrollIntoView());

          return {
            ...draft,
            href,
            label: labelText,
            to: draft.from + labelText.length,
            hasExistingLink: true,
          };
        })
      );

      return next ?? draft;
    },
    [markUserEdit, runEditorAction]
  );

  const handleRemoveLink = useCallback(() => {
    if (!linkPopover.visible) return;
    markUserEdit();

    void runEditorAction((crepe) => {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const markType = linkSchema.type(ctx);
        const tr = view.state.tr.removeMark(linkPopover.from, linkPopover.to, markType).scrollIntoView();
        view.dispatch(tr);
      });
    });

    setLinkPopover(HIDDEN_LINK_POPOVER);
  }, [linkPopover, markUserEdit, runEditorAction]);

  const handleLinkHrefChange = useCallback((value: string) => {
    setLinkPopover((current) => applyLinkState({ ...current, href: value }));
  }, [applyLinkState]);

  const handleLinkLabelChange = useCallback((value: string) => {
    setLinkPopover((current) => applyLinkState({ ...current, label: value }));
  }, [applyLinkState]);

  const handleOpenImage = useCallback(() => {
    const src = imagePopover.src.trim();
    if (!src) return;
    window.open(src, '_blank', 'noopener,noreferrer');
  }, [imagePopover.src]);

  const handleCopyImageUrl = useCallback(() => {
    const src = imagePopover.src.trim();
    if (!src || !navigator.clipboard) return;
    void navigator.clipboard.writeText(src);
  }, [imagePopover.src]);

  return (
    <div
      ref={rootRef}
      className="atomic-milkdown-editor pm-eval-editor relative mx-auto w-full max-w-6xl"
    >
      <div ref={mountRef} />
      <AtomicSelectionToolbar
        state={selectionToolbar}
        showLinkAction={showLinkAction}
        onToggleBold={handleToggleBold}
        onToggleItalic={handleToggleItalic}
        onToggleCode={handleToggleCode}
        onToggleLink={handleToggleLink}
      />
      <AtomicLinkPopover
        state={linkPopover}
        onHrefChange={handleLinkHrefChange}
        onLabelChange={handleLinkLabelChange}
        onRemove={handleRemoveLink}
      />
      <AtomicImagePopover
        state={imagePopover}
        onOpen={handleOpenImage}
        onCopyUrl={handleCopyImageUrl}
      />
    </div>
  );
}
