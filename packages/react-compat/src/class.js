/**
 * what-react/class: importing it installs class components (index.js
 * _installClasses), for a program whose classes do not extend Component or
 * PureComponent (whose definition installs them): a class whose prototype is
 * marked `isReactComponent` by hand, as React accepts, or by a library.
 * what-react's Vite plugin adds the import to every module that has
 * `isReactComponent` in it; a build without the plugin imports it once.
 */
import { _installClasses } from './index.js';

_installClasses();
