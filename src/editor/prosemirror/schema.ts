import { schema as markdownSchema, defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown';

export const prosemirrorEvalSchema = markdownSchema;
export const prosemirrorEvalMarkdownParser = defaultMarkdownParser;
export const prosemirrorEvalMarkdownSerializer = defaultMarkdownSerializer;
