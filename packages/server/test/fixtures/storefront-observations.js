// Compare user-facing DOM while allowing renderer-specific bookkeeping.
export function visibleTree(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return null;
  const attrs = [...node.attributes]
    .filter(({ name }) => ['id', 'for'].includes(name))
    .map(({ name, value }) => [name, value])
    .sort();
  if (node.localName === 'input') attrs.push(['value', node.value]);
  const children = [];
  for (const child of node.childNodes) {
    const value = visibleTree(child);
    if (value == null || value === '') continue;
    if (typeof value === 'string' && typeof children.at(-1) === 'string') {
      children[children.length - 1] += value;
    } else {
      children.push(value);
    }
  }
  return [node.localName, attrs, children];
}

export function recallElements(document) {
  const root = document.querySelector('#storefront');
  return [...root.querySelectorAll('*'), root].map(element => {
    const path = [];
    for (let current = element; current !== root; current = current.parentElement) {
      path.unshift([...current.parentElement.children].indexOf(current));
    }
    return { element, path, label: element.id || element.localName };
  });
}

export function replacedElements(document, originals) {
  const root = document.querySelector('#storefront');
  return originals.filter(({ element, path }) => {
    if (element.id) return document.getElementById(element.id) !== element;
    return path.reduce((node, index) => node?.children[index], root) !== element;
  }).map(({ label }) => label);
}

export function view(document) {
  return {
    body: [...document.body.children]
      .filter(node => node.localName !== 'script' && node.localName !== 'template')
      .map(visibleTree),
    title: document.title,
    description: document.head.querySelector('meta[name="description"]')?.content,
    application: document.head.querySelector('meta[name="application-name"]')?.content,
  };
}

export function act(document, type) {
  if (type === 'input') {
    const input = document.querySelector('#name');
    input.value = 'Grace';
    input.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  } else {
    document.querySelector('#' + type).click();
  }
}

export function interactionState(document) {
  return {
    sort: document.querySelector('#sort').textContent,
    products: [...document.querySelectorAll('#products li')].map(li => li.textContent),
    details: Boolean(document.querySelector('#details')),
    input: document.querySelector('#name').value,
    preview: document.querySelector('#name-preview').textContent,
    cart: document.querySelector('#cart').textContent,
    rating: document.querySelector('#rating')?.textContent ?? null,
    likes: document.querySelector('#like').textContent,
  };
}

export const updatedState = {
  sort: 'Sort (1)', products: ['Pear', 'Apple'], details: false,
  input: 'Grace', preview: 'Grace', cart: '1',
  rating: 'Rated 4.5', likes: 'Likes 1',
};
