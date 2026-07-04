// Invalid hook usage (no JSX). Proves the hook value signatures are real,
// not `any`: a number state's setter rejects a string. Errors with TS2345.
import { useState } from 'what-react';

const [count, setCount] = useState(0);
// count is number; passing a string to the setter must error.
setCount('nope');

export { count };
