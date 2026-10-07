<script>
import { h } from 'vue';
import { parseMarkdown } from '../../shared/markdown.js';

// Renders conversation Markdown as Vue nodes; nothing is ever inserted as HTML.
function inline(nodes) {
  return nodes.map(node => {
    switch (node.type) {
      case 'text': return node.text;
      case 'code': return h('code', node.text);
      case 'strong': return h('strong', inline(node.children));
      case 'em': return h('em', inline(node.children));
      case 'del': return h('del', inline(node.children));
      case 'link': return h('a', { href: node.href, target: '_blank', rel: 'noopener noreferrer nofollow' }, inline(node.children));
      case 'image': return h('a', { href: node.src, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'md-image-link' }, [h('img', { src: node.src, alt: node.alt, loading: 'lazy', referrerpolicy: 'no-referrer', class: 'md-image' })]);
      default: return '';
    }
  });
}

const lines = list => list.flatMap((line, index) => index ? [h('br'), ...inline(line)] : inline(line));

export default {
  name: 'RichText',
  props: { text: { type: String, default: '' } },
  setup(props) {
    return () => h('div', { class: 'rich-text' }, parseMarkdown(props.text).map(block => {
      if (block.type === 'code') return h('pre', [h('code', block.text)]);
      if (block.type === 'quote') return h('blockquote', lines(block.lines));
      if (block.type === 'heading') return h('p', { class: 'md-heading' }, inline(block.inline));
      if (block.type === 'list') return h(block.ordered ? 'ol' : 'ul', block.ordered && block.start !== 1 ? { start: block.start } : null, block.items.map(item => h('li', inline(item))));
      return h('p', lines(block.lines));
    }));
  }
};
</script>
