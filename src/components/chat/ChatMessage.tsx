import { useState, useCallback, Fragment, ReactNode } from 'react';
import { CheckCircle2, Loader2, Wrench, XCircle } from 'lucide-react';
import { ChatMessageWithContext, ChatCitation, ChatToolCall } from '../../stores/chat';
import { CitationLink, CitationPopover } from '../wiki';
import { MarkdownImage } from '../ui/MarkdownImage';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatMessageProps {
  message: ChatMessageWithContext;
  isStreaming?: boolean;
  onViewAtom?: (atomId: string) => void;
  searchQuery?: string;
  highlightText?: (text: string) => ReactNode;
}

export function ChatMessage({ message, isStreaming = false, onViewAtom, searchQuery = '', highlightText }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  const [activeCitation, setActiveCitation] = useState<ChatCitation | null>(null);
  const [anchorRect, setAnchorRect] = useState<{ top: number; left: number; bottom: number; width: number } | null>(null);

  // Create a map of citation index to citation object
  const citationMap = new Map(
    (message.citations || []).map((c) => [c.citation_index, c])
  );

  const handleCitationClick = (citation: ChatCitation, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setActiveCitation(citation);
    setAnchorRect({ top: rect.top, left: rect.left, bottom: rect.bottom, width: rect.width });
  };

  const handleClosePopover = () => {
    setActiveCitation(null);
    setAnchorRect(null);
  };

  const handleViewAtom = (atomId: string) => {
    if (onViewAtom) {
      onViewAtom(atomId);
    }
    handleClosePopover();
  };

  // Process text to replace [N] patterns with CitationLink components
  // Returns array of strings and CitationLink elements (strings for highlighting, elements for citations)
  const processTextWithCitations = (text: string): (string | JSX.Element)[] => {
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const index = parseInt(match[1], 10);
        const citation = citationMap.get(index);
        if (citation) {
          return (
            <CitationLink
              key={`citation-${i}-${index}`}
              index={index}
              onClick={(e) => handleCitationClick(citation, e.currentTarget)}
            />
          );
        }
      }
      // Return raw string so highlighting can be applied
      return part;
    });
  };

  // Process children recursively to handle citations and search highlighting in all text nodes
  const processChildren = useCallback((children: ReactNode): ReactNode => {
    if (typeof children === 'string') {
      // First process citations, then apply highlighting
      const withCitations = processTextWithCitations(children);
      if (searchQuery.trim() && highlightText) {
        // Apply highlighting to string parts, keep citation elements as-is
        return withCitations.map((part, i) => {
          if (typeof part === 'string') {
            return <Fragment key={`hl-${i}`}>{highlightText(part)}</Fragment>;
          }
          // Citation link element - keep as is
          return part;
        });
      }
      // No search - wrap strings in fragments for valid React output
      return withCitations.map((part, i) =>
        typeof part === 'string' ? <Fragment key={`t-${i}`}>{part}</Fragment> : part
      );
    }
    if (Array.isArray(children)) {
      return children.map((child, i) => (
        <Fragment key={i}>{processChildren(child)}</Fragment>
      ));
    }
    return children;
  }, [searchQuery, highlightText]);

  // Custom components for react-markdown with citation processing
  const markdownComponents = {
    p: ({ children }: { children?: ReactNode }) => (
      <p>{processChildren(children)}</p>
    ),
    li: ({ children }: { children?: ReactNode }) => (
      <li>{processChildren(children)}</li>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td>{processChildren(children)}</td>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th>{processChildren(children)}</th>
    ),
    strong: ({ children }: { children?: ReactNode }) => (
      <strong>{processChildren(children)}</strong>
    ),
    em: ({ children }: { children?: ReactNode }) => (
      <em>{processChildren(children)}</em>
    ),
    del: ({ children }: { children?: ReactNode }) => (
      <del>{processChildren(children)}</del>
    ),
    h1: ({ children }: { children?: ReactNode }) => (
      <h1>{processChildren(children)}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2>{processChildren(children)}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3>{processChildren(children)}</h3>
    ),
    h4: ({ children }: { children?: ReactNode }) => (
      <h4>{processChildren(children)}</h4>
    ),
    h5: ({ children }: { children?: ReactNode }) => (
      <h5>{processChildren(children)}</h5>
    ),
    h6: ({ children }: { children?: ReactNode }) => (
      <h6>{processChildren(children)}</h6>
    ),
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote>{processChildren(children)}</blockquote>
    ),
    // Style links with search highlighting
    a: ({ children, href }: { children?: ReactNode; href?: string }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 decoration-[var(--color-border-hover)] hover:decoration-current transition-colors"
      >
        {processChildren(children)}
      </a>
    ),
    // Style code with search highlighting
    code: ({ className, children }: { className?: string; children?: ReactNode }) => {
      const isBlock = className?.startsWith('language-');
      if (isBlock) {
        return <code className={className}>{processChildren(children)}</code>;
      }
      return (
        <code className="px-1 py-0.5 bg-[var(--color-bg-main)] rounded text-[#e5c07b]">
          {processChildren(children)}
        </code>
      );
    },
    pre: ({ children }: { children?: ReactNode }) => (
      <pre>{children}</pre>
    ),
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <MarkdownImage src={src} alt={alt} />
    ),
  };

  return (
    <>
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`max-w-[85%] rounded-lg px-4 py-3 ${
            isUser
              ? 'bg-[var(--color-accent)] text-white'
              : 'bg-[var(--color-bg-card)] text-[var(--color-text-primary)]'
          }`}
        >
          {/* Tool calls — render above message content so users see the
              retrieval steps before the prose that references them. Rendered
              during streaming (from streamingToolCalls) and persisted after
              completion (from message.tool_calls). */}
          {isAssistant && message.tool_calls && message.tool_calls.length > 0 && (
            <ToolCallList calls={message.tool_calls} />
          )}

          {/* Message content */}
          {isAssistant ? (
            message.content ? (
              <div className="prose prose-invert prose-sm max-w-none prose-headings:text-[var(--color-text-primary)] prose-p:text-[var(--color-text-primary)] prose-a:text-[var(--color-text-primary)] prose-a:underline prose-a:decoration-[var(--color-border-hover)] prose-a:hover:decoration-current prose-strong:text-[var(--color-text-primary)] prose-code:text-[var(--color-accent-light)] prose-code:bg-[var(--color-bg-card)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-[var(--color-bg-card)] prose-pre:border prose-pre:border-[var(--color-border)] prose-blockquote:border-l-[var(--color-accent)] prose-blockquote:text-[var(--color-text-secondary)] prose-li:text-[var(--color-text-primary)] prose-hr:border-[var(--color-border)]">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            ) : isStreaming ? (
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span>Thinking…</span>
              </div>
            ) : null
          ) : (
            <p className="whitespace-pre-wrap text-sm">
              {searchQuery.trim() && highlightText
                ? highlightText(message.content)
                : message.content}
            </p>
          )}

          {/* Streaming indicator (cursor) — only once content has started */}
          {isStreaming && message.content && (
            <span className="inline-block w-2 h-4 ml-1 bg-[var(--color-accent-light)] animate-pulse" />
          )}

          {/* Citations (for assistant messages) */}
          {isAssistant && message.citations && message.citations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
              <p className="text-xs text-[var(--color-text-secondary)] mb-2">Sources:</p>
              <div className="flex flex-wrap gap-1">
                {message.citations.map((citation) => (
                  <button
                    key={citation.id}
                    onClick={(e) => handleCitationClick(citation, e.currentTarget)}
                    className="px-2 py-0.5 text-xs rounded bg-[var(--color-bg-hover)] hover:bg-[var(--color-border-hover)] text-[var(--color-accent-light)] transition-colors cursor-pointer"
                    title={citation.excerpt}
                  >
                    [{citation.citation_index}]
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Citation popover */}
      {activeCitation && anchorRect && (
        <CitationPopover
          citation={activeCitation}
          anchorRect={anchorRect}
          onClose={handleClosePopover}
          onViewAtom={handleViewAtom}
        />
      )}
    </>
  );
}

function ToolCallList({ calls }: { calls: ChatToolCall[] }) {
  return (
    <div className="mb-2 space-y-1">
      {calls.map((call) => (
        <ToolCallCard key={call.id} call={call} />
      ))}
    </div>
  );
}

function ToolCallCard({ call }: { call: ChatToolCall }) {
  const statusIcon =
    call.status === 'running' ? (
      <Loader2 className="w-3.5 h-3.5 text-[var(--color-accent-light)] animate-spin" />
    ) : call.status === 'failed' ? (
      <XCircle className="w-3.5 h-3.5 text-red-400" />
    ) : call.status === 'complete' ? (
      <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-accent-light)]" />
    ) : (
      <Wrench className="w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />
    );

  const resultsCount =
    call.tool_output && typeof call.tool_output === 'object' && call.tool_output !== null
      ? (call.tool_output as { results_count?: number }).results_count
      : undefined;

  const summaryText =
    call.status === 'running'
      ? 'running…'
      : resultsCount !== undefined
      ? `${resultsCount} result${resultsCount === 1 ? '' : 's'}`
      : call.status;

  return (
    <details className="group text-xs bg-[var(--color-bg-main)] rounded border border-[var(--color-border)] open:border-[var(--color-border-hover)]">
      <summary className="flex items-center gap-2 px-2 py-1.5 cursor-pointer list-none hover:bg-[var(--color-bg-hover)]">
        {statusIcon}
        <span className="font-mono text-[var(--color-accent)]">{call.tool_name}</span>
        <span className="ml-auto text-[var(--color-text-tertiary)]">{summaryText}</span>
      </summary>
      <div className="px-2 pb-2 pt-1 border-t border-[var(--color-border)] space-y-2">
        <ToolJsonBlock label="input" value={call.tool_input} />
        {call.tool_output !== null && call.tool_output !== undefined && (
          <ToolJsonBlock label="output" value={call.tool_output} />
        )}
      </div>
    </details>
  );
}

function ToolJsonBlock({ label, value }: { label: string; value: unknown }) {
  const formatted = (() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  })();
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] mb-0.5">
        {label}
      </div>
      <pre className="text-[11px] whitespace-pre-wrap break-words bg-[var(--color-bg-card)] rounded px-2 py-1.5 text-[var(--color-text-secondary)]">
        {formatted}
      </pre>
    </div>
  );
}
