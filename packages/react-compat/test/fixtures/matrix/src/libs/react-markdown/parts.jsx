/** @jsxImportSource react */
// Components handed to <Markdown components={...}> that hold state, an effect
// or a ref are rendered by React, so they come from a React file (the native
// variant imports them too).
import { useEffect, useRef, useState } from 'react';

// How many highlighted code blocks are mounted right now.
const live = { blocks: 0 };
globalThis.__mdLive = live;

// What a syntax highlighter does: once the block is in the page, an effect
// reads the element through a ref and marks it; the cleanup takes the mark back.
export function Code({ node, className, children, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    const lang = (className || '').replace('language-', '') || 'text';
    ref.current.dataset.highlighted = `${lang}:${ref.current.textContent.trim().length}`;
    live.blocks++;
    return () => { live.blocks--; };
  }, [className, children]);
  return <code ref={ref} className={className} {...props}>{children}</code>;
}

// A list item with state of its own.
export function Item({ node, children, ...props }) {
  const [picked, setPicked] = useState(false);
  return <li {...props} data-picked={picked} onClick={() => setPicked(!picked)}>{children}</li>;
}
