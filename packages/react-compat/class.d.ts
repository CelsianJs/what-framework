/**
 * Importing `what-react/class` installs class components for a program whose
 * classes do not extend `Component` or `PureComponent` (which install them):
 * a class whose prototype is marked `isReactComponent` by hand, as React
 * accepts, or by a library. what-react's Vite plugin adds the import to every
 * module that has `isReactComponent` in it; a build without the plugin
 * imports it once. It exports nothing.
 */
export {};
