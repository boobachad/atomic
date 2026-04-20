import type { Node as ProsemirrorNode } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';

export function createImageNodeView(
  node: ProsemirrorNode,
  view: EditorView,
  getPos: (() => number | undefined) | boolean
): NodeView {
  const dom = document.createElement('figure');
  dom.className = 'pm-eval-image';

  const img = document.createElement('img');
  img.className = 'pm-eval-image__img';
  img.src = node.attrs.src;
  img.alt = node.attrs.alt || '';
  if (node.attrs.title) {
    img.title = node.attrs.title;
  }
  dom.appendChild(img);

  if (node.attrs.alt) {
    const caption = document.createElement('figcaption');
    caption.className = 'pm-eval-image__caption';
    caption.textContent = node.attrs.alt;
    dom.appendChild(caption);
  }

  const sourcePanel = document.createElement('div');
  sourcePanel.className = 'pm-eval-image__source';

  const srcInput = document.createElement('input');
  srcInput.className = 'pm-eval-image__input';
  srcInput.placeholder = 'Image URL';
  srcInput.value = node.attrs.src || '';

  const altInput = document.createElement('input');
  altInput.className = 'pm-eval-image__input';
  altInput.placeholder = 'Alt text';
  altInput.value = node.attrs.alt || '';

  sourcePanel.append(srcInput, altInput);
  dom.appendChild(sourcePanel);

  const setSelected = (selected: boolean) => {
    dom.dataset.selected = selected ? 'true' : 'false';
  };

  const applyAttrs = () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (typeof pos !== 'number') return;
    const nextAttrs = {
      ...node.attrs,
      src: srcInput.value.trim(),
      alt: altInput.value.trim(),
    };
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, nextAttrs));
  };

  const onClick = (event: MouseEvent) => {
    if (typeof getPos !== 'function') return;
    event.preventDefault();
    const pos = getPos();
    if (typeof pos !== 'number') return;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus();
  };

  dom.addEventListener('click', onClick);
  srcInput.addEventListener('change', applyAttrs);
  altInput.addEventListener('change', applyAttrs);

  return {
    dom,
    update(updatedNode) {
      if (updatedNode.type !== node.type) return false;
      node = updatedNode;
      img.src = updatedNode.attrs.src;
      img.alt = updatedNode.attrs.alt || '';
      srcInput.value = updatedNode.attrs.src || '';
      altInput.value = updatedNode.attrs.alt || '';
      const caption = dom.querySelector('.pm-eval-image__caption') as HTMLElement | null;
      if (updatedNode.attrs.alt) {
        if (caption) {
          caption.textContent = updatedNode.attrs.alt;
        } else {
          const nextCaption = document.createElement('figcaption');
          nextCaption.className = 'pm-eval-image__caption';
          nextCaption.textContent = updatedNode.attrs.alt;
          dom.insertBefore(nextCaption, sourcePanel);
        }
      } else if (caption) {
        caption.remove();
      }
      return true;
    },
    selectNode() {
      setSelected(true);
    },
    deselectNode() {
      setSelected(false);
    },
    stopEvent(event) {
      return event.target === img || event.target === srcInput || event.target === altInput;
    },
    ignoreMutation() {
      return true;
    },
    destroy() {
      dom.removeEventListener('click', onClick);
      srcInput.removeEventListener('change', applyAttrs);
      altInput.removeEventListener('change', applyAttrs);
    },
  };
}
