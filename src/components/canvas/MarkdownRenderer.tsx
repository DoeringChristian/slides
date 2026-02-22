import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { TextStyle } from '../../types/presentation';

interface Props {
  text: string;
  style: TextStyle;
  zoom: number;
}

export const MarkdownRenderer: React.FC<Props> = ({ text, style, zoom }) => {
  return (
    <div
      className="markdown-content"
      style={{
        fontSize: `${style.fontSize * zoom}px`,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        color: style.color,
        textAlign: style.align,
        lineHeight: style.lineHeight,
        textDecoration: style.textDecoration === 'none' ? undefined : style.textDecoration,
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Style headers to respect the base font size
          h1: ({ children }) => (
            <h1 style={{ fontSize: '2em', fontWeight: 'bold', margin: '0.5em 0 0.25em' }}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontSize: '1.5em', fontWeight: 'bold', margin: '0.5em 0 0.25em' }}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontSize: '1.25em', fontWeight: 'bold', margin: '0.5em 0 0.25em' }}>{children}</h3>
          ),
          // Style lists
          ul: ({ children }) => (
            <ul style={{ margin: '0.25em 0', paddingLeft: '1.5em', listStyleType: 'disc' }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '0.25em 0', paddingLeft: '1.5em', listStyleType: 'decimal' }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: '0.1em 0' }}>{children}</li>
          ),
          // Style links
          a: ({ href, children }) => (
            <a href={href} style={{ color: '#2563eb', textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // Style code blocks
          code: ({ className, children }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code style={{
                  backgroundColor: 'rgba(0,0,0,0.05)',
                  padding: '0.1em 0.3em',
                  borderRadius: '3px',
                  fontFamily: 'monospace',
                  fontSize: '0.9em',
                }}>
                  {children}
                </code>
              );
            }
            return (
              <code className={className} style={{ fontFamily: 'monospace' }}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre style={{
              backgroundColor: 'rgba(0,0,0,0.05)',
              padding: '0.5em',
              borderRadius: '4px',
              overflow: 'auto',
              margin: '0.5em 0',
            }}>
              {children}
            </pre>
          ),
          // Paragraphs
          p: ({ children }) => (
            <p style={{ margin: '0.25em 0' }}>{children}</p>
          ),
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: '3px solid #ccc',
              paddingLeft: '0.75em',
              margin: '0.5em 0',
              color: '#666',
            }}>
              {children}
            </blockquote>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};
