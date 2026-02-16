/**
 * Simple Markdown-to-HTML converter.
 * Handles: headings, bold, italic, inline code, code blocks,
 * unordered lists, links, and paragraphs.
 */
export function parseMarkdown(input) {
  if (!input) return '';

  const lines = input.split('\n');
  const html = [];
  let inCodeBlock = false;
  let codeBlockContent = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks (```)
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        // Close code block
        html.push(`<pre style="background:#1a1a1a;border:1px solid #333;border-radius:0.5rem;padding:1rem;overflow-x:auto;font-family:monospace;font-size:0.875rem;color:#e5e5e5;margin:0.75rem 0;"><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        // Close any open list first
        if (inList) {
          html.push('</ul>');
          inList = false;
        }
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      const level = headingMatch[1].length;
      const text = formatInline(headingMatch[2]);
      const sizes = { 1: '1.75rem', 2: '1.375rem', 3: '1.125rem' };
      const margins = { 1: '1.5rem 0 0.75rem', 2: '1.25rem 0 0.625rem', 3: '1rem 0 0.5rem' };
      html.push(`<h${level} style="font-size:${sizes[level]};font-weight:700;color:#f5f5f5;margin:${margins[level]};line-height:1.3;">${text}</h${level}>`);
      continue;
    }

    // Unordered lists (- item)
    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) {
        html.push('<ul style="margin:0.5rem 0;padding-left:1.5rem;color:#ccc;">');
        inList = true;
      }
      html.push(`<li style="margin:0.25rem 0;line-height:1.6;">${formatInline(listMatch[1])}</li>`);
      continue;
    }

    // Regular paragraph
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
    html.push(`<p style="margin:0.5rem 0;line-height:1.7;color:#ccc;">${formatInline(line)}</p>`);
  }

  // Close any open blocks
  if (inCodeBlock) {
    html.push(`<pre style="background:#1a1a1a;border:1px solid #333;border-radius:0.5rem;padding:1rem;overflow-x:auto;font-family:monospace;font-size:0.875rem;color:#e5e5e5;margin:0.75rem 0;"><code>${escapeHtml(codeBlockContent.join('\n'))}</code></pre>`);
  }
  if (inList) {
    html.push('</ul>');
  }

  return html.join('\n');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatInline(text) {
  let result = escapeHtml(text);

  // Bold (**text**)
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong style="color:#f5f5f5;font-weight:600;">$1</strong>');

  // Italic (*text*) — but not already part of bold
  result = result.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em style="color:#ddd;font-style:italic;">$1</em>');

  // Inline code (`code`)
  result = result.replace(/`([^`]+?)`/g, '<code style="background:#1a1a1a;border:1px solid #333;padding:0.125rem 0.375rem;border-radius:0.25rem;font-family:monospace;font-size:0.8125rem;color:#e5e5e5;">$1</code>');

  // Links ([text](url))
  result = result.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#3b82f6;text-decoration:none;border-bottom:1px solid #3b82f633;">$1</a>');

  return result;
}
