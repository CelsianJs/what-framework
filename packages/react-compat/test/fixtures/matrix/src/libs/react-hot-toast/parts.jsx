/** @jsxImportSource react */
// JSX handed to a React package from outside a React tag has to be React's.
import toast from 'react-hot-toast';

export const createCustom = (item, onClose) => <div id="ht-jsx">custom <button id="ht-jsx-close" onClick={() => { toast.dismiss(item.id); onClose(); }}>x</button></div>;
