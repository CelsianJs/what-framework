// Valid what-compiler public-API usage. Must type-check clean via the shipped
// .d.ts declarations.
import {
  what,
  vitePlugin,
  babelPlugin,
  scanPages,
  extractPageConfig,
  generateRoutesModule,
} from 'what-compiler';
import whatVite, { jsxPreserveConfig } from 'what-compiler/vite';
import babel from 'what-compiler/babel';
import { detectPageExports } from 'what-compiler/file-router';

const plugin = what({ pages: 'src/pages', production: true, hot: false });
const pluginName: string = plugin.name;

const plugin2 = whatVite();
const plugin3 = vitePlugin({ include: /\.tsx$/, sourceMaps: false });
void plugin2;
void plugin3;
void jsxPreserveConfig({ viteVersion: '6.0.0' });

const babelP = babelPlugin({ types: {} });
const babelVisitor = babelP.visitor;
void babelVisitor;
void babel;

const routes = scanPages('src/pages');
const pageCount: number = routes.pages.length;
void pageCount;

const cfg = extractPageConfig('export const page = { mode: "static" }');
const mode: string = cfg.mode;
void mode;

const exportsInfo = detectPageExports('export const loader = () => {}');
const hasLoader: boolean = exportsInfo.hasLoader;
void hasLoader;

const routesSource: string = generateRoutesModule('src/pages', '/root');
void routesSource;
