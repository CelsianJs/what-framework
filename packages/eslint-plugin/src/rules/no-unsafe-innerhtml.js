/**
 * Rule: what/no-unsafe-innerhtml
 *
 * The runtime sets innerHTML only from an explicit { __html: content } object,
 * so a raw string never becomes markup by accident (XSS). Pass the marker, or
 * render the content as text.
 *
 * Bad:  <div innerHTML={userInput} />
 * Good: <div innerHTML={{ __html: sanitized }} />
 */

function hasHtmlMarker(expression) {
  return expression?.type === 'ObjectExpression' && expression.properties.some((p) =>
    p.type === 'Property' && ((p.key.type === 'Identifier' && p.key.name === '__html') || p.key.value === '__html'));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require the { __html } marker for innerHTML',
      recommended: true,
      code: 'ERR_UNSAFE_INNERHTML',
    },
    messages: {
      rawInnerHTML: 'innerHTML needs the explicit marker: innerHTML={{ __html: content }}. A raw value is refused at runtime.',
    },
    schema: [],
  },

  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'innerHTML') return;
        const value = node.value;
        if (value?.type === 'JSXExpressionContainer' && hasHtmlMarker(value.expression)) return;
        context.report({ node, messageId: 'rawInnerHTML' });
      },
    };
  },
};
