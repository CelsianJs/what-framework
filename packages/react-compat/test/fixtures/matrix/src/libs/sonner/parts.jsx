/** @jsxImportSource react */
// JSX handed to a React package from outside a React tag has to be React's:
// native.jsx gets this element from a React file.
import { toast } from 'sonner';

export const createCustom = (id) => <div id="so-jsx">custom <button id="so-jsx-close" onClick={() => toast.dismiss(id)}>x</button></div>;
