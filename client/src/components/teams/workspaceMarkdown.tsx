import React from 'react';
import { isValidHttpsPortfolioUrl } from '../profile/profileValidation';

/**
 * Strips known dangerous HTML tags and event handlers (NR-009).
 */
export function sanitizeMarkdownText(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\s*on\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');
}

/**
 * Parses inline tokens (links, bold, code) into React elements.
 * Unsafe link schemes are replaced with "[unsafe link removed]" (NR-009).
 */
export function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Tokenizer pattern for links [label](url), bold **bold**, and inline code `code`
  const tokenRegex = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const fullMatch = match[0];
    const linkLabel = match[2];
    const linkUrl = match[3];
    const boldText = match[4];
    const codeText = match[5];

    if (linkLabel !== undefined && linkUrl !== undefined) {
      const trimmedUrl = linkUrl.trim();
      if (isValidHttpsPortfolioUrl(trimmedUrl)) {
        nodes.push(
          <a
            key={`link-${match.index}`}
            href={trimmedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-forest-700 underline hover:text-forest-900 break-all"
          >
            {linkLabel}
          </a>
        );
      } else {
        nodes.push(
          <span
            key={`unsafe-${match.index}`}
            className="text-amber-800 italic font-mono text-xs bg-amber-50 px-1 py-0.5 rounded border border-amber-200"
            title="Unsafe link removed"
          >
            [unsafe link removed]
          </span>
        );
      }
    } else if (boldText !== undefined) {
      nodes.push(
        <strong key={`bold-${match.index}`} className="font-semibold text-ink-950">
          {boldText}
        </strong>
      );
    } else if (codeText !== undefined) {
      nodes.push(
        <code
          key={`code-${match.index}`}
          className="px-1.5 py-0.5 bg-cream-100 text-ink-900 rounded font-mono text-xs border border-cream-200"
        >
          {codeText}
        </code>
      );
    } else {
      nodes.push(fullMatch);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/**
 * Renders sanitized Markdown to safe React JSX elements without dangerouslySetInnerHTML (NR-009).
 */
export function renderSafeMarkdown(markdown: string): React.JSX.Element {
  const sanitized = sanitizeMarkdownText(markdown);
  const lines = sanitized.replace(/\r\n/g, '\n').split('\n');

  const elements: React.JSX.Element[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let listItems: Array<{ type: 'ul' | 'ol'; content: string }> = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const isUl = listItems[0].type === 'ul';
    const items = listItems.map((item, idx) => (
      <li key={`list-item-${idx}`} className="my-0.5 leading-relaxed">
        {renderInlineMarkdown(item.content)}
      </li>
    ));

    if (isUl) {
      elements.push(
        <ul
          key={`ul-${elements.length}`}
          className="list-disc ml-5 my-2 text-ink-800 space-y-0.5"
        >
          {items}
        </ul>
      );
    } else {
      elements.push(
        <ol
          key={`ol-${elements.length}`}
          className="list-decimal ml-5 my-2 text-ink-800 space-y-0.5"
        >
          {items}
        </ol>
      );
    }
    listItems = [];
  };

  const flushCodeBlock = () => {
    if (codeBlockLines.length === 0) return;
    elements.push(
      <pre
        key={`pre-${elements.length}`}
        className="p-3 my-2 bg-ink-900 text-cream-100 rounded-md overflow-x-auto text-xs font-mono border border-ink-800"
      >
        <code>{codeBlockLines.join('\n')}</code>
      </pre>
    );
    codeBlockLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block toggles
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Empty line separates blocks
    if (!trimmed) {
      flushList();
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h3
          key={`h3-${elements.length}`}
          className="text-base font-semibold text-ink-900 mt-3 mb-1"
        >
          {renderInlineMarkdown(trimmed.slice(4))}
        </h3>
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h2
          key={`h2-${elements.length}`}
          className="text-lg font-bold text-ink-900 mt-4 mb-1.5"
        >
          {renderInlineMarkdown(trimmed.slice(3))}
        </h2>
      );
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h1
          key={`h1-${elements.length}`}
          className="text-xl font-bold text-ink-900 mt-4 mb-2"
        >
          {renderInlineMarkdown(trimmed.slice(2))}
        </h1>
      );
      continue;
    }

    // Unordered list item
    const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (listItems.length > 0 && listItems[0].type !== 'ul') {
        flushList();
      }
      listItems.push({ type: 'ul', content: ulMatch[1] });
      continue;
    }

    // Ordered list item
    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (listItems.length > 0 && listItems[0].type !== 'ol') {
        flushList();
      }
      listItems.push({ type: 'ol', content: olMatch[1] });
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p
        key={`p-${elements.length}`}
        className="my-1.5 text-sm text-ink-800 leading-relaxed"
      >
        {renderInlineMarkdown(trimmed)}
      </p>
    );
  }

  flushList();
  if (inCodeBlock) {
    flushCodeBlock();
  }

  return (
    <div
      className="space-y-1 text-sm text-ink-900 font-sans"
      data-testid="safe-markdown-container"
    >
      {elements.length > 0 ? (
        elements
      ) : (
        <p className="text-ink-500 italic text-sm">No content.</p>
      )}
    </div>
  );
}
