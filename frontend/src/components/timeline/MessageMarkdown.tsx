import React, { useState } from 'react';
import { CheckIcon, CopyIcon } from './icons';

export interface MessageMarkdownProps {
  content: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Syntax Tokenizer for Code Highlighting
// ---------------------------------------------------------------------------
interface SyntaxToken {
  type: 'keyword' | 'string' | 'comment' | 'number' | 'type' | 'text';
  text: string;
}

function tokenizeLine(line: string, _lang: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let i = 0;

  while (i < line.length) {
    // Single-line comment // or #
    if (
      (line[i] === '/' && line[i + 1] === '/') ||
      (line[i] === '#' && (i === 0 || /\s/.test(line[i - 1])))
    ) {
      tokens.push({ type: 'comment', text: line.slice(i) });
      break;
    }

    // Strings: "...", '...', `...`
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const quote = line[i];
      let str = quote;
      i++;
      while (i < line.length && line[i] !== quote) {
        if (line[i] === '\\' && i + 1 < line.length) {
          str += line[i] + line[i + 1];
          i += 2;
        } else {
          str += line[i];
          i++;
        }
      }
      if (i < line.length && line[i] === quote) {
        str += quote;
        i++;
      }
      tokens.push({ type: 'string', text: str });
      continue;
    }

    // Numbers:
    const numMatch = line.slice(i).match(/^\b(\d+(\.\d+)?)\b/);
    if (numMatch) {
      tokens.push({ type: 'number', text: numMatch[0] });
      i += numMatch[0].length;
      continue;
    }

    // Word tokens (keywords, types, identifiers)
    const wordMatch = line.slice(i).match(/^[a-zA-Z_$][a-zA-Z0-9_$]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      const keywords = new Set([
        'import', 'from', 'export', 'default', 'const', 'let', 'var',
        'function', 'return', 'if', 'else', 'for', 'while', 'switch',
        'case', 'break', 'class', 'extends', 'interface', 'type', 'async',
        'await', 'try', 'catch', 'throw', 'new', 'typeof', 'instanceof',
        'true', 'false', 'null', 'undefined', 'def', 'self', 'lambda',
      ]);
      const types = new Set([
        'string', 'number', 'boolean', 'any', 'void', 'never', 'unknown',
        'Promise', 'Array', 'Record', 'Set', 'Map', 'React',
      ]);

      if (keywords.has(word)) {
        tokens.push({ type: 'keyword', text: word });
      } else if (types.has(word)) {
        tokens.push({ type: 'type', text: word });
      } else {
        tokens.push({ type: 'text', text: word });
      }
      i += word.length;
      continue;
    }

    // Plain symbol / space
    tokens.push({ type: 'text', text: line[i] });
    i++;
  }

  return tokens;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const lines = code.replace(/\r\n/g, '\n').split('\n');

  return (
    <div
      className="my-3 overflow-hidden rounded-md border border-border-default bg-[#080a0f] text-xs font-mono"
      data-testid="code-block"
      data-language={language || 'text'}
    >
      <div className="flex items-center justify-between border-b border-border-subtle bg-bg-surface/50 px-3 py-1.5 text-text-tertiary select-none">
        <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">
          {language || 'text'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] text-text-tertiary hover:bg-bg-surface-hover hover:text-text-primary transition-colors focus:outline-none"
          data-testid="copy-code-btn"
        >
          {copied ? (
            <>
              <CheckIcon className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <CopyIcon className="w-3 h-3" />
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>

      <pre className="overflow-x-auto p-3 leading-relaxed text-text-secondary">
        <code>
          {lines.map((line, lineIdx) => {
            const tokens = tokenizeLine(line, language);
            return (
              <div key={lineIdx} className="flex">
                <span className="mr-3 w-6 shrink-0 select-none text-right text-[10px] text-text-tertiary/60">
                  {lineIdx + 1}
                </span>
                <span className="min-w-0 flex-1">
                  {tokens.map((token, tokIdx) => {
                    let color = 'text-text-secondary';
                    if (token.type === 'keyword') color = 'text-[#7aa2f7] font-medium'; // soft blue
                    else if (token.type === 'string') color = 'text-[#9ece6a]'; // green
                    else if (token.type === 'comment') color = 'text-[#565f89] italic'; // muted slate
                    else if (token.type === 'number') color = 'text-[#ff9e64]'; // orange
                    else if (token.type === 'type') color = 'text-[#2ac3de]'; // cyan
                    return (
                      <span key={tokIdx} className={color}>
                        {token.text}
                      </span>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline Markdown Parser: bold, italic, strikethrough, inline code, links
// ---------------------------------------------------------------------------
export function renderInlineMarkdown(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  // Tokenize with regex matching code, bold/italic, strikethrough, links
  // Pattern:
  // 1: `code`
  // 2: **bold** or __bold__
  // 3: ~~strike~~
  // 4: *italic* or _italic_
  // 5: [label](url)
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(~~[^~]+~~)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token}`;

    if (token.startsWith('`') && token.endsWith('`')) {
      elements.push(
        <code
          key={key}
          className="rounded bg-bg-surface-active px-1.5 py-0.5 font-mono text-[11px] text-accent border border-border-default select-text"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      elements.push(
        <strong key={key} className="font-semibold text-text-primary">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      elements.push(
        <del key={key} className="line-through text-text-tertiary">
          {token.slice(2, -2)}
        </del>
      );
    } else if (
      (token.startsWith('*') && token.endsWith('*')) ||
      (token.startsWith('_') && token.endsWith('_'))
    ) {
      elements.push(
        <em key={key} className="italic text-text-secondary">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        elements.push(
          <a
            key={key}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover hover:underline transition-colors"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        elements.push(token);
      }
    } else {
      elements.push(token);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements.length > 0 ? elements : [text];
}

// ---------------------------------------------------------------------------
// Block Level Markdown Parser
// ---------------------------------------------------------------------------
export function MessageMarkdown({ content, className = '' }: MessageMarkdownProps) {
  if (!content) return null;

  const rawLines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    // Fenced code block: ```lang
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length && !rawLines[i].trim().startsWith('```')) {
        codeLines.push(rawLines[i]);
        i++;
      }
      i++; // Skip closing ```
      blocks.push(
        <CodeBlock
          key={`code-${i}`}
          code={codeLines.join('\n')}
          language={language}
        />
      );
      continue;
    }

    // Horizontal rule: --- or ***
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(
        <hr key={`hr-${i}`} className="my-4 border-t border-border-default" />
      );
      i++;
      continue;
    }

    // Headings: # H1, ## H2, etc.
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const headingClasses: Record<number, string> = {
        1: 'text-lg font-bold text-text-primary mt-4 mb-2 pb-1 border-b border-border-subtle',
        2: 'text-base font-semibold text-text-primary mt-3 mb-2',
        3: 'text-sm font-semibold text-text-primary mt-2 mb-1',
        4: 'text-xs font-semibold text-text-primary mt-2 mb-1',
        5: 'text-xs font-medium text-text-secondary mt-1 mb-1',
        6: 'text-xs font-medium text-text-tertiary mt-1 mb-1',
      };
      blocks.push(
        <div key={`h-${i}`} className={headingClasses[level]}>
          {renderInlineMarkdown(text)}
        </div>
      );
      i++;
      continue;
    }

    // Blockquote: > text
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < rawLines.length && rawLines[i].startsWith('>')) {
        quoteLines.push(rawLines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={`quote-${i}`}
          className="my-2 border-l-2 border-accent/60 bg-bg-surface/30 pl-3 py-1 text-xs italic text-text-secondary"
        >
          {quoteLines.map((ql, qIdx) => (
            <div key={qIdx}>{renderInlineMarkdown(ql)}</div>
          ))}
        </blockquote>
      );
      continue;
    }

    // GFM Table: | col 1 | col 2 |
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (
        i < rawLines.length &&
        rawLines[i].trim().startsWith('|') &&
        rawLines[i].trim().endsWith('|')
      ) {
        tableLines.push(rawLines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const headerRow = tableLines[0]
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        // Skip separator row (tableLines[1], e.g. |---|---|)
        const dataRows = tableLines.slice(2).map((row) =>
          row
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim())
        );

        blocks.push(
          <div key={`table-${i}`} className="my-3 overflow-x-auto" data-testid="markdown-table">
            <table className="w-full text-left border-collapse text-xs border border-border-default">
              <thead>
                <tr className="border-b border-border-default bg-bg-surface/80">
                  {headerRow.map((h, colIdx) => (
                    <th
                      key={colIdx}
                      className="px-3 py-2 font-medium text-text-primary border-r border-border-subtle last:border-r-0"
                    >
                      {renderInlineMarkdown(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle bg-bg-app/20">
                {dataRows.map((row, rowIdx) => (
                  <tr
                    key={rowIdx}
                    className="hover:bg-bg-surface/30 transition-colors"
                  >
                    {row.map((cell, cellIdx) => (
                      <td
                        key={cellIdx}
                        className="px-3 py-1.5 text-text-secondary border-r border-border-subtle last:border-r-0"
                      >
                        {renderInlineMarkdown(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // Lists: Unordered (*, -, +) or Ordered (1.) or Task lists (- [ ])
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const listItems: { isOrdered: boolean; text: string; isTask?: boolean; checked?: boolean }[] = [];
      const isOrdered = /^\s*\d+\.\s+/.test(line);

      while (i < rawLines.length && /^\s*([-*+]|\d+\.)\s+/.test(rawLines[i])) {
        const itemLine = rawLines[i];
        const match = itemLine.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
        if (match) {
          let itemText = match[2];
          let isTask = false;
          let checked = false;

          const taskMatch = itemText.match(/^\[([ xX])\]\s+(.*)$/);
          if (taskMatch) {
            isTask = true;
            checked = taskMatch[1].toLowerCase() === 'x';
            itemText = taskMatch[2];
          }

          listItems.push({ isOrdered, text: itemText, isTask, checked });
        }
        i++;
      }

      blocks.push(
        <div key={`list-${i}`} className="my-2 space-y-1 text-xs">
          {listItems.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2 text-text-secondary">
              {item.isTask ? (
                <input
                  type="checkbox"
                  checked={item.checked}
                  readOnly
                  className="mt-0.5 h-3.5 w-3.5 rounded border-border-default bg-bg-surface text-accent cursor-default"
                />
              ) : item.isOrdered ? (
                <span className="w-4 shrink-0 font-mono text-[11px] text-text-tertiary select-none text-right">
                  {idx + 1}.
                </span>
              ) : (
                <span className="shrink-0 text-text-tertiary select-none">•</span>
              )}
              <div className="flex-1 leading-relaxed">
                {renderInlineMarkdown(item.text)}
              </div>
            </div>
          ))}
        </div>
      );
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Regular paragraph: gather consecutive text lines
    const paragraphLines: string[] = [];
    while (
      i < rawLines.length &&
      rawLines[i].trim() &&
      !rawLines[i].trim().startsWith('```') &&
      !rawLines[i].match(/^(#{1,6})\s+/) &&
      !rawLines[i].startsWith('>') &&
      !rawLines[i].trim().startsWith('|') &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(rawLines[i].trim()) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(rawLines[i])
    ) {
      paragraphLines.push(rawLines[i]);
      i++;
    }

    blocks.push(
      <p
        key={`p-${i}`}
        className="my-1.5 text-xs leading-relaxed text-text-secondary"
      >
        {paragraphLines.map((pl, plIdx) => (
          <React.Fragment key={plIdx}>
            {plIdx > 0 && <br />}
            {renderInlineMarkdown(pl)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return (
    <div
      className={`message-markdown font-sans text-xs select-text ${className}`}
      data-testid="message-markdown"
    >
      {blocks}
    </div>
  );
}
