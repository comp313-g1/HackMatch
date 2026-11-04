import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  sanitizeMarkdownText,
  renderSafeMarkdown,
  renderInlineMarkdown,
} from './workspaceMarkdown';

describe('workspaceMarkdown module (US-023 / #US-023-T6 / NR-009)', () => {
  describe('sanitizeMarkdownText', () => {
    it('strips script, iframe, object, embed tags and on* event handlers', () => {
      const dangerous =
        'Hello <script>alert("xss")</script><iframe src="evil.com"></iframe><img src="x" onerror="alert(1)" /> world';
      const clean = sanitizeMarkdownText(dangerous);
      expect(clean).not.toContain('<script');
      expect(clean).not.toContain('</script>');
      expect(clean).not.toContain('<iframe');
      expect(clean).not.toContain('onerror=');
      expect(clean).toContain('Hello');
      expect(clean).toContain('world');
    });
  });

  describe('renderInlineMarkdown', () => {
    it('renders safe https links as clickable anchor tags', () => {
      render(<div>{renderInlineMarkdown('Check out [GitHub](https://github.com/myteam/repo)')}</div>);
      const link = screen.getByRole('link', { name: 'GitHub' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://github.com/myteam/repo');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('neutralizes javascript:, data:, and http: links into [unsafe link removed] (NR-009)', () => {
      render(
        <div>
          {renderInlineMarkdown(
            'Evil: [click me](javascript:alert(1)) and [data](data:text/html,evil) and [insecure](http://insecure.com)'
          )}
        </div>
      );
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      const removedSpans = screen.getAllByText('[unsafe link removed]');
      expect(removedSpans).toHaveLength(3);
    });

    it('renders bold and inline code correctly', () => {
      render(<div>{renderInlineMarkdown('This is **bold text** and `inline code`')}</div>);
      expect(screen.getByText('bold text').tagName).toBe('STRONG');
      expect(screen.getByText('inline code').tagName).toBe('CODE');
    });
  });

  describe('renderSafeMarkdown', () => {
    it('renders headings, lists, code fences, and paragraphs without dangerouslySetInnerHTML', () => {
      const markdown = `
# Project Title
## Architecture
### Database
- PostgreSQL
- Supabase

1. Step One
2. Step Two

\`\`\`ts
const x = 1;
\`\`\`

This is a regular concept paragraph.
      `;

      render(renderSafeMarkdown(markdown));

      expect(screen.getByRole('heading', { level: 1, name: 'Project Title' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Architecture' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3, name: 'Database' })).toBeInTheDocument();
      expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
      expect(screen.getByText('Step One')).toBeInTheDocument();
      expect(screen.getByText('const x = 1;')).toBeInTheDocument();
      expect(screen.getByText('This is a regular concept paragraph.')).toBeInTheDocument();
    });

    it('handles empty content gracefully', () => {
      render(renderSafeMarkdown(''));
      expect(screen.getByText('No content.')).toBeInTheDocument();
    });
  });
});
