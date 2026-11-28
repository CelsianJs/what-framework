// Type probe compiled by ../../render-query-types.test.js: a parsed query with
// a repeated key (?tag=a&tag=b) is what the adapter hands a page's loader, so
// renderDocument and the loader context accept and describe it.
import { renderDocument, renderPage, type RenderRequestContext } from 'what-server';
import { h } from 'what-framework';
import { parseQuery } from 'what-router';

const page = { default: () => h('p', null), loader: (ctx: RenderRequestContext) => ctx.query?.tag };
export const doc = renderDocument(page, { query: { tag: ['a', 'b'], one: '1' } });
export const parsed = renderPage(page, { query: parseQuery('?tag=a&tag=b') });
export const tags = (ctx: RenderRequestContext): string[] => {
  const v = ctx.query?.tag;
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};
