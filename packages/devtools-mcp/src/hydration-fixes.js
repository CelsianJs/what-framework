export const HYDRATION_FIXES = {
  tag: 'Render the same element and namespace on the server and on the first client pass. Move browser-dependent branches after hydration. A component that inspects its children (children.length, a test on children) builds them before its own element claims its node: read props.children only where it renders them, and pass the data it inspects as a prop.',
  text: 'Seed the first client value from the server, including locale and formatting. Apply browser-only changes in onMount().',
  missing: 'Ensure the server renders the branch or child present on the first client pass.',
  'extra-nodes': 'Remove server-only children or include them in the first client render, in the same order.',
  'shadow-root': 'Render the same shadow host on both sides. Initialize its shadow contents in the component after hydration so the client can own them.',
  marker: 'Serve the compiled markup with its What comments intact. Build both sides from the same hydratable component tree.',
  key: 'Use stable data-derived keys, strings or finite numbers, and the same initial list order on both sides. This report does not replace matching DOM.',
  'not-hydratable': 'Build the client with the compiler hydratable option. Defer manually constructed DOM until onMount().',
};
