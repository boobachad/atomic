import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { CrepeBuilder } from '@milkdown/crepe/builder';
import { blockEdit } from '@milkdown/crepe/feature/block-edit';
import { codeMirror } from '@milkdown/crepe/feature/code-mirror';
import { imageBlock } from '@milkdown/crepe/feature/image-block';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import { table } from '@milkdown/crepe/feature/table';

// We import Crepe features individually instead of using the batteries-included
// `Crepe` class, because `@milkdown/crepe`'s root module statically imports
// every feature (katex, the toolbar's katex, prosemirror-virtual-cursor, …).
// Runtime `features: { [X]: false }` toggles can't tree-shake those — only
// omitting the import from the module graph does. Dropping `latex` + `toolbar`
// is what pulled the editor chunk under the workbox precache ceiling.
//
// If you need a feature back, add its `@milkdown/crepe/feature/<name>` import
// and a matching `.addFeature(...)` call below.

function legacy(parser: StreamParser<unknown>): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(parser));
}

// Curated list of languages we want in the code-block language selector.
// Each `load()` is a dynamic import, which Rollup splits into its own lazy
// chunk — so grammars download only when a user picks that language.
//
// We avoid `@codemirror/language-data`'s full catalog (50+ languages, ~1 MB
// of grammars) and ship only what we actually write. Add to this list if
// you want another language; `npm install @codemirror/lang-<name>` (or pull
// a stream parser from `@codemirror/legacy-modes`) and add an entry.
const CODE_BLOCK_LANGUAGES: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'jsx'],
    extensions: ['js', 'mjs', 'cjs', 'jsx'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts', 'tsx'],
    extensions: ['ts', 'mts', 'cts', 'tsx'],
    load: () =>
      import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true, jsx: true })),
  }),
  LanguageDescription.of({
    name: 'Python',
    alias: ['py'],
    extensions: ['py'],
    load: () => import('@codemirror/lang-python').then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: 'Go',
    extensions: ['go'],
    load: () => import('@codemirror/lang-go').then((m) => m.go()),
  }),
  LanguageDescription.of({
    name: 'Rust',
    alias: ['rs'],
    extensions: ['rs'],
    load: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  }),
  LanguageDescription.of({
    name: 'Ruby',
    alias: ['rb'],
    extensions: ['rb'],
    load: () => import('@codemirror/legacy-modes/mode/ruby').then((m) => legacy(m.ruby)),
  }),
  LanguageDescription.of({
    name: 'Java',
    extensions: ['java'],
    load: () => import('@codemirror/lang-java').then((m) => m.java()),
  }),
  LanguageDescription.of({
    name: 'C',
    extensions: ['c', 'h'],
    load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  }),
  LanguageDescription.of({
    name: 'C++',
    alias: ['cpp'],
    extensions: ['cpp', 'c++', 'cc', 'cxx', 'hpp', 'h++', 'hh', 'hxx'],
    load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  }),
  LanguageDescription.of({
    name: 'PHP',
    extensions: ['php'],
    load: () => import('@codemirror/lang-php').then((m) => m.php()),
  }),
  LanguageDescription.of({
    name: 'Swift',
    extensions: ['swift'],
    load: () => import('@codemirror/legacy-modes/mode/swift').then((m) => legacy(m.swift)),
  }),
  LanguageDescription.of({
    name: 'Shell',
    alias: ['bash', 'sh', 'zsh'],
    extensions: ['sh', 'bash', 'zsh'],
    load: () => import('@codemirror/legacy-modes/mode/shell').then((m) => legacy(m.shell)),
  }),
  LanguageDescription.of({
    name: 'SQL',
    extensions: ['sql'],
    load: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['htm'],
    extensions: ['html', 'htm'],
    load: () => import('@codemirror/lang-html').then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: 'CSS',
    extensions: ['css'],
    load: () => import('@codemirror/lang-css').then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: 'XML',
    extensions: ['xml'],
    load: () => import('@codemirror/lang-xml').then((m) => m.xml()),
  }),
  LanguageDescription.of({
    name: 'JSON',
    extensions: ['json'],
    load: () => import('@codemirror/lang-json').then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: 'YAML',
    alias: ['yml'],
    extensions: ['yaml', 'yml'],
    load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  }),
  LanguageDescription.of({
    name: 'TOML',
    extensions: ['toml'],
    load: () => import('@codemirror/legacy-modes/mode/toml').then((m) => legacy(m.toml)),
  }),
  LanguageDescription.of({
    name: 'Dockerfile',
    filename: /^Dockerfile$/,
    load: () =>
      import('@codemirror/legacy-modes/mode/dockerfile').then((m) => legacy(m.dockerFile)),
  }),
  LanguageDescription.of({
    name: 'Markdown',
    alias: ['md'],
    extensions: ['md', 'markdown', 'mkd'],
    load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  }),
];

export type AtomicCrepeOptions = {
  root: HTMLElement;
  defaultValue?: string;
  placeholderText?: string;
  imageBlockUploadPlaceholder?: string;
};

export function buildAtomicCrepe(options: AtomicCrepeOptions): CrepeBuilder {
  const {
    root,
    defaultValue = '',
    placeholderText = '',
    imageBlockUploadPlaceholder = 'paste link',
  } = options;

  return new CrepeBuilder({ root, defaultValue })
    .addFeature(codeMirror, { languages: CODE_BLOCK_LANGUAGES, theme: oneDark })
    .addFeature(listItem)
    .addFeature(imageBlock, {
      inlineUploadButton: '',
      inlineUploadPlaceholderText: imageBlockUploadPlaceholder,
      blockUploadButton: '',
      blockUploadPlaceholderText: imageBlockUploadPlaceholder,
    })
    .addFeature(blockEdit)
    .addFeature(placeholder, { text: placeholderText })
    .addFeature(table);
}
