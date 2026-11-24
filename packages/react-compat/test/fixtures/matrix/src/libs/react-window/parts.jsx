/** @jsxImportSource react */
// A component handed to a React package as a prop (`rowComponent`) is rendered
// by React, so it comes from a React file.
export function Row({ index, style, selected, onPick }) {
  return (
    <div className="rw-row" data-index={index} style={style} aria-selected={selected === index} onClick={() => onPick(index)}>
      Row {index}{selected === index ? ' *' : ''}
    </div>
  );
}
