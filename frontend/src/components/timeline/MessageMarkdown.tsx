import React, { useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createHighlighter, type BundledLanguage, type Highlighter } from 'shiki';
import { CopyButton } from './CopyButton';
import { splitMarkdownSegments } from './asciiBox';
import { remarkHtmlBreaks } from './remarkHtmlBreaks';

export interface MessageMarkdownProps {
  content: string;
  className?: string;
  /** 消息仍在流式输出时为 true：此时代码块不做高亮，避免每个 delta 都整块重算 */
  streaming?: boolean;
}

// 超过任一阈值的代码块始终按纯文本渲染：Shiki 的 codeToHtml 是同步的，会阻塞主线程
export const HIGHLIGHT_MAX_CHARS = 100_000;
export const HIGHLIGHT_MAX_LINES = 2_000;

export function shouldHighlightCode(code: string): boolean {
  if (code.length > HIGHLIGHT_MAX_CHARS) return false;
  let lines = 1;
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10 && ++lines > HIGHLIGHT_MAX_LINES) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 链接安全校验：只允许 http:, https:, mailto: 协议
// 危险协议（如 javascript:, vbscript:, data: 等）严禁渲染到 href 中
// ---------------------------------------------------------------------------
export function isSafeUrl(url?: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  // 只允许 http:, https:, mailto: 协议
  return /^(https?|mailto):/i.test(trimmed);
}

// ---------------------------------------------------------------------------
// Shiki 代码高亮单例管理与高亮服务
// ---------------------------------------------------------------------------
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighterInstance(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-light', 'tokyo-night'],
      langs: [
        'typescript',
        'javascript',
        'tsx',
        'jsx',
        'json',
        'bash',
        'shell',
        'sh',
        'python',
        'html',
        'css',
        'markdown',
        'md',
        'yaml',
        'yml',
        'sql',
      ],
    });
  }
  return highlighterPromise;
}

export async function highlightCodeWithShiki(code: string, language: string): Promise<string | null> {
  try {
    const highlighter = await getHighlighterInstance();
    const lang = (language || '').toLowerCase().trim() || 'text';

    const loadedLangs: string[] = highlighter.getLoadedLanguages();
    if (lang !== 'text' && !loadedLangs.includes(lang)) {
      try {
        // Unknown names are rejected by loadLanguage and caught below
        await highlighter.loadLanguage(lang as BundledLanguage);
      } catch {
        // 动态加载失败则降级到 text
      }
    }

    const effectiveLang = (highlighter.getLoadedLanguages() as string[]).includes(lang) ? lang : 'text';
    return highlighter.codeToHtml(code, {
      lang: effectiveLang,
      // Inline colors are the light theme; theme.css switches to --shiki-dark under the dark theme
      themes: { light: 'github-light', dark: 'tokyo-night' },
      defaultColor: 'light',
    });
  } catch (err) {
    console.warn('Failed to highlight code with shiki:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// CodeBlock 组件：带复制按钮、语言标签以及 Shiki 代码高亮
// ---------------------------------------------------------------------------
function CodeBlock({ code, language }: { code: string; language: string }) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const highlightEnabled = React.useContext(HighlightContext);

  useEffect(() => {
    if (!highlightEnabled || !shouldHighlightCode(code)) {
      setHighlightedHtml(null);
      return;
    }
    let isMounted = true;
    highlightCodeWithShiki(code, language).then((html) => {
      if (isMounted && html) {
        setHighlightedHtml(html);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [code, language, highlightEnabled]);

  return (
    <div
      className="my-3 overflow-hidden rounded-md border border-border-default bg-bg-code text-[13px] font-mono"
      data-testid="code-block"
      data-language={language || 'text'}
    >
      <div className="flex items-center justify-between border-b border-border-subtle bg-bg-surface/50 px-3 py-1.5 text-text-tertiary select-none">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
          {language || 'text'}
        </span>
        <CopyButton text={code} label="复制代码" testId="copy-code-btn" />
      </div>

      {highlightedHtml ? (
        <div
          className="overflow-x-auto p-3 leading-relaxed [&>pre]:!bg-transparent [&>pre]:!m-0 [&>pre]:!p-0 [&>pre]:!border-0 text-text-secondary font-mono"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : (
        <pre className="overflow-x-auto p-3 leading-relaxed text-text-secondary font-mono">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 上下文：用于精准区分 <pre> 内的代码块与普通行内代码
// ---------------------------------------------------------------------------
const InPreContext = React.createContext(false);
const HighlightContext = React.createContext(true);

const markdownComponents: Components = {
  // 标题 Headings
  h1: ({ node: _node, children, ...rest }) => (
    <h1 className="text-xl font-bold text-text-primary mt-4 mb-2 pb-1 border-b border-border-subtle" {...rest}>
      {children}
    </h1>
  ),
  h2: ({ node: _node, children, ...rest }) => (
    <h2 className="text-lg font-semibold text-text-primary mt-3 mb-2" {...rest}>
      {children}
    </h2>
  ),
  h3: ({ node: _node, children, ...rest }) => (
    <h3 className="text-base font-semibold text-text-primary mt-2 mb-1" {...rest}>
      {children}
    </h3>
  ),
  h4: ({ node: _node, children, ...rest }) => (
    <h4 className="text-[15px] font-semibold text-text-primary mt-2 mb-1" {...rest}>
      {children}
    </h4>
  ),
  h5: ({ node: _node, children, ...rest }) => (
    <h5 className="text-sm font-medium text-text-secondary mt-1 mb-1" {...rest}>
      {children}
    </h5>
  ),
  h6: ({ node: _node, children, ...rest }) => (
    <h6 className="text-sm font-medium text-text-tertiary mt-1 mb-1" {...rest}>
      {children}
    </h6>
  ),

  // 段落、引用与水平分割线
  p: ({ node: _node, children, ...rest }) => (
    <p className="my-2 text-[15px] leading-7 text-text-secondary" {...rest}>
      {children}
    </p>
  ),
  blockquote: ({ node: _node, children, ...rest }) => (
    <blockquote className="my-2 border-l-2 border-accent/60 bg-bg-surface/30 pl-3 py-1 text-[15px] italic text-text-secondary" {...rest}>
      {children}
    </blockquote>
  ),
  hr: ({ node: _node, ...rest }) => (
    <hr className="my-4 border-t border-border-default" {...rest} />
  ),

  // 格式化文本
  strong: ({ node: _node, children, ...rest }) => (
    <strong className="font-semibold text-text-primary" {...rest}>
      {children}
    </strong>
  ),
  em: ({ node: _node, children, ...rest }) => (
    <em className="italic text-text-secondary" {...rest}>
      {children}
    </em>
  ),
  del: ({ node: _node, children, ...rest }) => (
    <del className="line-through text-text-tertiary" {...rest}>
      {children}
    </del>
  ),

  // 安全链接校验：只允许 http:, https:, mailto: 协议，危险协议严禁渲染到 href 中
  a: ({ node: _node, href, children, ...rest }) => {
    if (!href || !isSafeUrl(href)) {
      return <span>{children}</span>;
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent hover:text-accent-hover hover:underline transition-colors"
        {...rest}
      >
        {children}
      </a>
    );
  },

  // 表格 Tables (GFM)
  table: ({ node: _node, children, ...rest }) => (
    <div className="my-3 overflow-x-auto" data-testid="markdown-table">
      <table className="w-full text-left border-collapse text-sm border border-border-default" {...rest}>
        {children}
      </table>
    </div>
  ),
  thead: ({ node: _node, children, ...rest }) => (
    <thead className="border-b border-border-default bg-bg-surface/80" {...rest}>
      {children}
    </thead>
  ),
  tbody: ({ node: _node, children, ...rest }) => (
    <tbody className="divide-y divide-border-subtle bg-bg-app/20" {...rest}>
      {children}
    </tbody>
  ),
  tr: ({ node: _node, children, ...rest }) => (
    <tr className="hover:bg-bg-surface/30 transition-colors" {...rest}>
      {children}
    </tr>
  ),
  th: ({ node: _node, children, ...rest }) => (
    <th className="px-3 py-2 font-medium text-text-primary border-r border-border-subtle last:border-r-0" {...rest}>
      {children}
    </th>
  ),
  td: ({ node: _node, children, ...rest }) => (
    <td className="px-3 py-1.5 text-text-secondary border-r border-border-subtle last:border-r-0" {...rest}>
      {children}
    </td>
  ),

  // 列表 Lists & 复选框 Checkboxes
  ul: ({ node: _node, children, className, ...rest }) => {
    const isTaskList = className?.includes('contains-task-list');
    return (
      <ul
        className={`my-2 space-y-1.5 text-[15px] leading-7 text-text-secondary ${
          isTaskList ? 'list-none pl-0' : 'list-disc pl-5'
        } ${className || ''}`}
        {...rest}
      >
        {children}
      </ul>
    );
  },
  ol: ({ node: _node, children, className, ...rest }) => (
    <ol
      className={`my-2 space-y-1.5 text-[15px] leading-7 text-text-secondary list-decimal pl-5 ${className || ''}`}
      {...rest}
    >
      {children}
    </ol>
  ),
  li: ({ node: _node, children, className, ...rest }) => {
    const isTaskItem = className?.includes('task-list-item');
    return (
      <li
        className={`leading-relaxed ${
          isTaskItem ? 'flex items-start gap-2 list-none' : ''
        } ${className || ''}`}
        {...rest}
      >
        {children}
      </li>
    );
  },
  input: (props) => {
    if (props.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={props.checked}
          disabled
          readOnly
          className="mt-0.5 h-3.5 w-3.5 rounded border-border-default bg-bg-surface text-accent cursor-default shrink-0"
        />
      );
    }
    const { node: _node, ...inputProps } = props;
    return <input {...inputProps} />;
  },

  // 代码块与行内代码
  pre: ({ children }) => (
    <InPreContext.Provider value={true}>
      {children}
    </InPreContext.Provider>
  ),
  code: ({ node: _node, className, children, ...rest }) => {
    const isInsidePre = React.useContext(InPreContext);
    if (isInsidePre) {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      const codeString = String(children).replace(/\n$/, '');
      return <CodeBlock code={codeString} language={language} />;
    }
    return (
      <code
        className="rounded bg-bg-surface-active px-1.5 py-0.5 font-mono text-[13px] text-accent border border-border-default select-text"
        {...rest}
      >
        {children}
      </code>
    );
  },
};

// ---------------------------------------------------------------------------
// 纯展示无状态 MessageMarkdown 组件
// ---------------------------------------------------------------------------
function AsciiBox({ text }: { text: string }) {
  return (
    <div
      className="my-3 overflow-hidden rounded-md border border-border-default bg-bg-code"
      data-testid="ascii-box"
    >
      <div className="flex items-center justify-end border-b border-border-subtle bg-bg-surface/50 px-2 py-1">
        <CopyButton text={text} label="复制" testId="copy-box-btn" />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-text-secondary whitespace-pre">
        {text}
      </pre>
    </div>
  );
}

export function MessageMarkdown({ content, className = '', streaming = false }: MessageMarkdownProps) {
  if (!content) return null;

  const segments = splitMarkdownSegments(content);

  return (
    <div
      className={`message-markdown font-sans text-[15px] select-text ${className}`}
      data-testid="message-markdown"
    >
      <HighlightContext.Provider value={!streaming}>
        {segments.map((segment, index) =>
          segment.kind === 'box' ? (
            <AsciiBox key={`box-${index}`} text={segment.text} />
          ) : (
            <ReactMarkdown
              key={`md-${index}`}
              remarkPlugins={[remarkGfm, remarkHtmlBreaks]}
              components={markdownComponents}
              urlTransform={(url) => {
                if (isSafeUrl(url)) return url;
                return '';
              }}
            >
              {segment.text}
            </ReactMarkdown>
          ),
        )}
      </HighlightContext.Provider>
    </div>
  );
}

// 兼容外部引用的辅助函数
export function renderInlineMarkdown(text: string): React.ReactNode {
  return <MessageMarkdown content={text} />;
}
