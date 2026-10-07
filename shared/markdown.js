// A small Markdown dialect for conversation messages. It produces a tree that RichText.vue
// renders with Vue, so message text never becomes raw HTML.
//
// Blocks: paragraphs (single line breaks kept), ``` code blocks, > quotes, - / 1. lists, # headings.
// Inline: **bold**, *italic*, ~~strike~~, `code`, [text](url), ![alt](https-image), bare URLs.

const LINK = /^(https?:\/\/|mailto:)/i;
const IMAGE = /^https:\/\//i;
export const safeHref = url => LINK.test(url) ? url : '';

// Inline patterns in priority order; the earliest match in the text wins.
const INLINE = [
  { type: 'code', re: /`([^`\n]+)`/ },
  { type: 'image', re: /!\[([^\]\n]*)\]\(\s*(\S+?)\s*\)/ },
  { type: 'link', re: /\[([^\]\n]+)\]\(\s*(\S+?)\s*\)/ },
  // Bare URLs stop at spaces and full-width punctuation; trailing ASCII punctuation is left out.
  { type: 'url', re: /\bhttps?:\/\/[^\s<>()\u3000-\u303f\uff00-\uffef]*[^\s<>().,;:!?'"\u3000-\u303f\uff00-\uffef]/ },
  { type: 'strong', re: /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__/ },
  { type: 'del', re: /~~(?=\S)([\s\S]*?\S)~~/ },
  { type: 'em', re: /\*(?=[^\s*])([^*\n]*?[^\s*])\*/ }
];

export function parseInline(text, depth = 0) {
  const nodes = [];
  let rest = text;
  while (rest) {
    let best = null;
    for (const pattern of INLINE) {
      const match = pattern.re.exec(rest);
      if (match && (!best || match.index < best.match.index)) best = { pattern, match };
    }
    if (!best) { nodes.push({ type: 'text', text: rest }); break; }
    const { pattern, match } = best;
    if (match.index) nodes.push({ type: 'text', text: rest.slice(0, match.index) });
    const inner = match[1] ?? match[2] ?? '';
    const nested = value => depth < 4 ? parseInline(value, depth + 1) : [{ type: 'text', text: value }];
    if (pattern.type === 'code') nodes.push({ type: 'code', text: inner });
    else if (pattern.type === 'image') {
      const src = match[2];
      if (IMAGE.test(src)) nodes.push({ type: 'image', src, alt: match[1] });
      else if (safeHref(src)) nodes.push({ type: 'link', href: src, children: [{ type: 'text', text: match[1] || src }] });
      else nodes.push({ type: 'text', text: match[0] });
    } else if (pattern.type === 'link') {
      const href = safeHref(match[2]);
      nodes.push(href ? { type: 'link', href, children: nested(match[1]) } : { type: 'text', text: match[0] });
    } else if (pattern.type === 'url') nodes.push({ type: 'link', href: match[0], children: [{ type: 'text', text: match[0] }] });
    else nodes.push({ type: pattern.type, children: nested(inner) });
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}

const LIST_ITEM = /^\s{0,3}(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/;

export function parseMarkdown(source = '') {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', lines: paragraph.map(line => parseInline(line)) });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      flush();
      const code = [];
      while (++index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index]);
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flush();
      const quoted = [];
      for (; index < lines.length && /^\s{0,3}>/.test(lines[index]); index++) quoted.push(lines[index].replace(/^\s{0,3}>\s?/, ''));
      index--;
      blocks.push({ type: 'quote', lines: quoted.map(item => parseInline(item)) });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      const ordered = Boolean(item[2]);
      const items = [];
      let start = ordered ? Number(item[2]) : 1;
      for (; index < lines.length; index++) {
        const next = LIST_ITEM.exec(lines[index]);
        if (!next || Boolean(next[2]) !== ordered) break;
        items.push(parseInline(next[3]));
      }
      index--;
      blocks.push({ type: 'list', ordered, start, items });
      continue;
    }
    const heading = /^\s{0,3}#{1,3}\s+(.*)$/.exec(line);
    if (heading) { flush(); blocks.push({ type: 'heading', inline: parseInline(heading[1]) }); continue; }
    if (!line.trim()) { flush(); continue; }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

// Plain-text preview without Markdown markers, e.g. for emails and notifications.
export function plainText(source = '') {
  const walk = nodes => nodes.map(node => {
    if (node.type === 'text' || node.type === 'code') return node.text;
    if (node.type === 'image') return (node.alt ? node.alt + ' ' : '') + node.src;
    const label = walk(node.children || []);
    return node.type === 'link' && label !== node.href ? `${label} (${node.href})` : label;
  }).join('');
  return parseMarkdown(source).map(block => {
    if (block.type === 'code') return block.text;
    if (block.type === 'list') return block.items.map(item => '• ' + walk(item)).join('\n');
    if (block.type === 'heading') return walk(block.inline);
    return block.lines.map(walk).join('\n');
  }).join('\n\n');
}
