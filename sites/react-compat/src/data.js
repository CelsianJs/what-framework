// Package data — 90 confirmed + 1 partial + 5 expected
export const pkgs = [
  // State Management
  { n: 'Zustand', d: '19.1M', c: 'State Management', s: 'pass', t: 'Benchmarked 2.5x faster' },
  { n: 'Jotai', d: '2.7M', c: 'State Management', s: 'pass', t: 'Benchmarked 3x faster atoms' },
  { n: 'Redux Toolkit + react-redux', d: '15.8M', c: 'State Management', s: 'pass', t: 'Full store + dispatch' },
  { n: 'Immer', d: '26.8M', c: 'State Management', s: 'pass', t: 'produce() with useState' },
  { n: 'valtio', d: '546K', c: 'State Management', s: 'pass', t: 'Proxy state + useSnapshot' },

  // Routing
  { n: 'React Router v6', d: '20.8M', c: 'Routing', s: 'pass', t: 'Routes, useNavigate, Outlet' },

  // UI Components
  { n: 'Radix UI', d: '19M', c: 'UI Components', s: 'pass', t: 'Dialog, Dropdown, Tooltip, etc.' },
  { n: 'MUI (Material UI)', d: '4.2M', c: 'UI Components', s: 'pass', t: 'Button, TextField, Alert, Badge, Switch' },
  { n: 'Ant Design', d: '1.6M', c: 'UI Components', s: 'pass', t: 'Table, Form, Button, Layout' },
  { n: 'Headless UI', d: '4.2M', c: 'UI Components', s: 'pass', t: 'Menu, Dialog, Listbox, Switch' },
  { n: 'cmdk', d: '8.4M', c: 'UI Components', s: 'pass', t: 'Radix-based command palette' },
  { n: 'vaul', d: '6.9M', c: 'UI Components', s: 'pass', t: 'Radix-based drawer component' },
  { n: 'react-day-picker', d: '9.8M', c: 'UI Components', s: 'pass', t: 'Full calendar grid + navigation' },
  { n: 'embla-carousel-react', d: '6.5M', c: 'UI Components', s: 'pass', t: 'Carousel hook + slides' },
  { n: 'react-colorful', d: '3.6M', c: 'UI Components', s: 'pass', t: 'Color picker + hue slider' },
  { n: '@floating-ui/react', d: '10.7M', c: 'UI Components', s: 'pass', t: 'useFloating tooltip positioning' },
  { n: 'react-popper', d: '4.7M', c: 'UI Components', s: 'pass', t: 'Popper.js integration' },
  { n: 'react-tooltip', d: '1.6M', c: 'UI Components', s: 'pass', t: 'Tooltip component, hover trigger' },
  { n: 'downshift', d: '1.5M', c: 'UI Components', s: 'pass', t: 'Accessible combobox primitive' },
  { n: 'react-modal', d: '1.3M', c: 'UI Components', s: 'pass', t: 'Accessible modal dialog' },
  { n: 'react-tabs', d: '900K', c: 'UI Components', s: 'pass', t: 'Accessible tabs component' },
  { n: 'react-paginate', d: '800K', c: 'UI Components', s: 'pass', t: 'Pagination with page controls' },
  { n: 'react-slick', d: '1.2M', c: 'UI Components', s: 'pass', t: 'Carousel/slider with dots' },
  { n: 'react-loading-skeleton', d: '1M', c: 'UI Components', s: 'pass', t: 'Skeleton loading screens' },
  { n: 'react-spinners', d: '800K', c: 'UI Components', s: 'pass', t: 'ClipLoader, BeatLoader, PulseLoader' },
  { n: 'react-resizable-panels', d: '4.6M', c: 'UI Components', s: 'pass', t: 'Resizable panel groups' },
  { n: 'input-otp', d: '1.4M', c: 'UI Components', s: 'pass', t: 'OTP input with slots render' },

  // Data Fetching
  { n: 'TanStack React Query', d: '12.3M', c: 'Data Fetching', s: 'pass', t: 'useQuery, useMutation' },
  { n: 'SWR', d: '1.2M', c: 'Data Fetching', s: 'pass', t: 'useSWR hook' },

  // Tables & Virtualization
  { n: 'TanStack Table', d: '5.3M', c: 'Tables', s: 'pass', t: 'Benchmarked 2.8x faster create' },
  { n: 'TanStack Virtual', d: '2.8M', c: 'Tables', s: 'pass', t: 'Benchmarked 10x faster scroll' },
  { n: 'AG Grid', d: '665K', c: 'Tables', s: 'pass', t: 'Full data grid, row/col defs' },
  { n: 'react-virtuoso', d: '650K', c: 'Tables', s: 'pass', t: 'Virtualized list, 200+ items' },

  // Forms
  { n: 'React Hook Form', d: '15.8M', c: 'Forms', s: 'pass', t: 'Benchmarked 3.5x faster reset' },
  { n: 'Formik', d: '3.4M', c: 'Forms', s: 'pass', t: 'Full form library + validation' },
  { n: 'react-dropzone', d: '7.2M', c: 'Forms', s: 'pass', t: 'useDropzone hook, drag-and-drop' },
  { n: 'react-number-format', d: '2.9M', c: 'Forms', s: 'pass', t: 'NumericFormat, thousand separator' },
  { n: 'React Select', d: '5.1M', c: 'Forms', s: 'pass', t: 'Searchable dropdown, custom styles' },
  { n: 'React DatePicker', d: '2.7M', c: 'Forms', s: 'pass', t: 'Calendar date selection' },
  { n: 'react-textarea-autosize', d: '1.5M', c: 'Forms', s: 'pass', t: 'Auto-resizing textarea' },
  { n: '@tanstack/react-form', d: '300K', c: 'Forms', s: 'pass', t: 'Headless form with field API' },

  // Charts
  { n: 'Recharts', d: '13.8M', c: 'Charts', s: 'pass', t: 'LineChart, XAxis, YAxis, CartesianGrid' },
  { n: 'react-chartjs-2', d: '2M', c: 'Charts', s: 'pass', t: 'Bar chart via Chart.js' },

  // Animation
  { n: 'Framer Motion', d: '9M', c: 'Animation', s: 'pass', t: 'Full API — animate, variants, exit' },
  { n: 'React Spring', d: '2.5M', c: 'Animation', s: 'pass', t: 'Springs, trails, transitions' },
  { n: 'react-transition-group', d: '22M', c: 'Animation', s: 'pass', t: 'CSSTransition with nodeRef' },
  { n: 'react-countup', d: '350K', c: 'Animation', s: 'pass', t: 'Animated number counter' },
  { n: 'react-fast-marquee', d: '500K', c: 'Animation', s: 'pass', t: 'Marquee/ticker animation' },
  { n: 'react-type-animation', d: '400K', c: 'Animation', s: 'pass', t: 'Typewriter text effect' },
  { n: 'react-confetti', d: '300K', c: 'Animation', s: 'pass', t: 'Confetti particle animation' },

  // CSS-in-JS
  { n: '@emotion/react', d: '13.4M', c: 'CSS-in-JS', s: 'pass', t: 'css() object styles, theme context' },
  { n: '@emotion/styled', d: '9.3M', c: 'CSS-in-JS', s: 'pass', t: 'styled.div, template literals' },
  { n: 'styled-components', d: '7.8M', c: 'CSS-in-JS', s: 'pass', t: 'v6, transient $props' },
  { n: 'Tailwind CSS v4', d: '40M+', c: 'CSS-in-JS', s: 'pass', t: '@tailwindcss/vite, all utilities' },

  // Drag & Drop
  { n: 'dnd-kit', d: '8.4M', c: 'Drag & Drop', s: 'pass', t: 'DndContext, useSortable' },
  { n: 'react-beautiful-dnd', d: '3M', c: 'Drag & Drop', s: 'pass', t: 'DragDropContext, Droppable, Draggable' },
  { n: 'react-dnd', d: '2.5M', c: 'Drag & Drop', s: 'pass', t: 'useDrag, useDrop, HTML5Backend' },
  { n: 'react-draggable', d: '4M', c: 'Drag & Drop', s: 'pass', t: 'Draggable, position tracking' },
  { n: 'react-resizable', d: '2.2M', c: 'Drag & Drop', s: 'pass', t: 'ResizableBox, min/max constraints' },

  // Notifications
  { n: 'sonner', d: '9.9M', c: 'Notifications', s: 'pass', t: 'Toaster + toast() API, portals' },
  { n: 'React Hot Toast', d: '1.6M', c: 'Notifications', s: 'pass', t: 'Lightweight toast() API' },
  { n: 'React Toastify', d: '2.6M', c: 'Notifications', s: 'pass', t: 'ToastContainer + rich options' },
  { n: 'notistack', d: '1.2M', c: 'Notifications', s: 'pass', t: 'SnackbarProvider, useSnackbar' },

  // Icons
  { n: 'React Icons', d: '5M', c: 'Icons', s: 'pass', t: 'All icon packs (FA, MD, etc.)' },
  { n: 'lucide-react', d: '5.2M', c: 'Icons', s: 'pass', t: 'Home, Settings, Search, Star, Heart' },
  { n: '@heroicons/react', d: '2.1M', c: 'Icons', s: 'pass', t: 'Beaker, Arrow, Home icons' },
  { n: '@radix-ui/react-icons', d: '2M', c: 'Icons', s: 'pass', t: 'Face, Gear, Rocket icons' },
  { n: '@phosphor-icons/react', d: '500K', c: 'Icons', s: 'pass', t: 'Lightning, Heart, Star + weights' },
  { n: '@mui/icons-material', d: '3.5M', c: 'Icons', s: 'pass', t: 'Home, Settings, Search icons' },

  // Content & Utilities
  { n: 'clsx', d: '17.1M', c: 'Utilities', s: 'pass', t: 'Class string builder utility' },
  { n: 'classnames', d: '13M', c: 'Utilities', s: 'pass', t: 'Class string builder utility' },
  { n: 'React Markdown', d: '2.4M', c: 'Utilities', s: 'pass', t: 'Markdown to React elements' },
  { n: 'react-i18next', d: '4.5M', c: 'Utilities', s: 'pass', t: 'useTranslation hook' },
  { n: 'React Helmet', d: '2.3M', c: 'Utilities', s: 'pass', t: 'Document head management' },
  { n: 'react-syntax-highlighter', d: '4.3M', c: 'Utilities', s: 'pass', t: 'Syntax-highlighted code blocks' },
  { n: 'react-copy-to-clipboard', d: '1.8M', c: 'Utilities', s: 'pass', t: 'Clipboard API wrapper' },
  { n: 'react-player', d: '1.5M', c: 'Utilities', s: 'pass', t: 'Media player, canPlay API' },
  { n: 'usehooks-ts', d: '2.6M', c: 'Utilities', s: 'pass', t: 'useBoolean, useLocalStorage' },
  { n: 'react-use', d: '2.8M', c: 'Utilities', s: 'pass', t: 'useToggle, useWindowSize, useMouse' },
  { n: '@uidotdev/usehooks', d: '800K', c: 'Utilities', s: 'pass', t: 'useToggle hooks collection' },
  { n: 'react-error-boundary', d: '4.8M', c: 'Utilities', s: 'pass', t: 'ErrorBoundary component' },
  { n: 'react-intersection-observer', d: '3.2M', c: 'Utilities', s: 'pass', t: 'useInView IntersectionObserver' },
  { n: 'react-hotkeys-hook', d: '1.7M', c: 'Utilities', s: 'pass', t: 'useHotkeys keyboard shortcuts' },
  { n: 'use-debounce', d: '1.5M', c: 'Utilities', s: 'pass', t: 'useDebouncedCallback hook' },
  { n: 'react-responsive', d: '1.2M', c: 'Utilities', s: 'pass', t: 'useMediaQuery hook' },
  { n: 'react-scroll', d: '800K', c: 'Utilities', s: 'pass', t: 'Smooth scroll Link + Element' },
  { n: 'react-qr-code', d: '300K', c: 'Utilities', s: 'pass', t: 'SVG QR code generator' },
  { n: 'react-json-view-lite', d: '200K', c: 'Utilities', s: 'pass', t: 'JSON tree viewer' },

  // Partial
  { n: 'react-window v2', d: '4.2M', c: 'Tables', s: 'partial', t: 'Import OK, render crashes on null ref' },

  // Expected Compatible (not yet tested live)
  { n: 'victory', d: '360K', c: 'Charts', s: 'expected', t: 'Composable chart components' },
  { n: 'react-apexcharts', d: '700K', c: 'Charts', s: 'expected', t: 'ApexCharts React wrapper' },
  { n: 'nivo', d: '350K', c: 'Charts', s: 'expected', t: 'Data visualization components' },
  { n: 'react-lottie-player', d: '300K', c: 'Animation', s: 'expected', t: 'Lottie animation player' },
  { n: 'react-aria-components', d: '500K', c: 'UI Components', s: 'expected', t: 'Adobe accessible primitives' },
];

// npm package name mapping
export const NPM = {
  'Zustand': 'zustand', 'Jotai': 'jotai', 'Immer': 'immer',
  'Redux Toolkit + react-redux': '@reduxjs/toolkit',
  'React Router v6': 'react-router-dom', 'Radix UI': '@radix-ui/react-dialog',
  'MUI (Material UI)': '@mui/material',
  'Ant Design': 'antd', 'Headless UI': '@headlessui/react',
  'TanStack React Query': '@tanstack/react-query', 'SWR': 'swr',
  'TanStack Table': '@tanstack/react-table', 'TanStack Virtual': '@tanstack/react-virtual',
  'React Hook Form': 'react-hook-form', 'Formik': 'formik',
  'Framer Motion': 'framer-motion', 'React Spring': '@react-spring/web',
  'Tailwind CSS v4': 'tailwindcss', 'React Hot Toast': 'react-hot-toast',
  'React Toastify': 'react-toastify', 'React Icons': 'react-icons',
  'React Markdown': 'react-markdown', 'React Helmet': 'react-helmet',
  'React Select': 'react-select', 'React DatePicker': 'react-datepicker',
  'AG Grid': 'ag-grid-react', 'Recharts': 'recharts',
  'react-window v2': 'react-window', 'react-beautiful-dnd': 'react-beautiful-dnd',
  'nivo': '@nivo/core', '@mui/icons-material': '@mui/icons-material',
  'react-dnd': 'react-dnd',
};

// GitHub repo mapping
export const REPOS = {
  'zustand': 'pmndrs/zustand', 'jotai': 'pmndrs/jotai', 'immer': 'immerjs/immer',
  '@reduxjs/toolkit': 'reduxjs/redux-toolkit', 'react-router-dom': 'remix-run/react-router',
  '@radix-ui/react-dialog': 'radix-ui/primitives', '@mui/material': 'mui/material-ui',
  'antd': 'ant-design/ant-design',
  '@headlessui/react': 'tailwindlabs/headlessui', 'cmdk': 'pacocoursey/cmdk',
  'vaul': 'emilkowalski/vaul', 'react-day-picker': 'gpbl/react-day-picker',
  'embla-carousel-react': 'davidjerleke/embla-carousel', 'react-colorful': 'omgovich/react-colorful',
  '@floating-ui/react': 'floating-ui/floating-ui', 'react-popper': 'popperjs/react-popper',
  'react-tooltip': 'ReactTooltip/react-tooltip', '@tanstack/react-query': 'TanStack/query',
  'swr': 'vercel/swr', '@tanstack/react-table': 'TanStack/table',
  '@tanstack/react-virtual': 'TanStack/virtual', 'react-hook-form': 'react-hook-form/react-hook-form',
  'formik': 'jaredpalmer/formik', 'react-dropzone': 'react-dropzone/react-dropzone',
  'react-number-format': 's-yadav/react-number-format', 'framer-motion': 'motiondivision/motion',
  '@react-spring/web': 'pmndrs/react-spring', 'react-transition-group': 'reactjs/react-transition-group',
  '@emotion/react': 'emotion-js/emotion', '@emotion/styled': 'emotion-js/emotion',
  'styled-components': 'styled-components/styled-components', 'tailwindcss': 'tailwindlabs/tailwindcss',
  '@dnd-kit/core': 'clauderic/dnd-kit', 'react-draggable': 'react-grid-layout/react-draggable',
  'react-resizable': 'react-grid-layout/react-resizable', 'sonner': 'emilkowalski/sonner',
  'react-hot-toast': 'timolins/react-hot-toast', 'react-toastify': 'fkhadra/react-toastify',
  'notistack': 'iamhosseindhv/notistack', 'react-icons': 'react-icons/react-icons',
  'react-markdown': 'remarkjs/react-markdown', 'react-i18next': 'i18next/react-i18next',
  'react-helmet': 'nfl/react-helmet', 'react-syntax-highlighter': 'react-syntax-highlighter/react-syntax-highlighter',
  'react-copy-to-clipboard': 'nkbt/react-copy-to-clipboard', 'react-player': 'cookpete/react-player',
  'usehooks-ts': 'juliencrn/usehooks-ts', 'react-use': 'streamich/react-use',
  'react-window': 'bvaughn/react-window', 'recharts': 'recharts/recharts',
  'react-select': 'JedWatson/react-select', 'react-datepicker': 'Hacker0x01/react-datepicker',
  'ag-grid-react': 'ag-grid/ag-grid', 'clsx': 'lukeed/clsx', 'classnames': 'JedWatson/classnames',
  'lucide-react': 'lucide-icons/lucide', 'react-error-boundary': 'bvaughn/react-error-boundary',
  'react-intersection-observer': 'thebuilder/react-intersection-observer',
  '@heroicons/react': 'tailwindlabs/heroicons', 'valtio': 'pmndrs/valtio',
  'react-chartjs-2': 'reactchartjs/react-chartjs-2', 'victory': 'FormidableLabs/victory',
  '@radix-ui/react-icons': 'radix-ui/icons', '@phosphor-icons/react': 'phosphor-icons/react',
  'react-apexcharts': 'apexcharts/react-apexcharts', '@nivo/core': 'plouc/nivo',
  'react-beautiful-dnd': 'atlassian/react-beautiful-dnd', 'downshift': 'downshift-js/downshift',
  'react-modal': 'reactjs/react-modal', 'react-tabs': 'reactjs/react-tabs',
  'react-paginate': 'AdeleD/react-paginate', 'react-slick': 'akiran/react-slick',
  'react-virtuoso': 'petyosi/react-virtuoso', 'react-pdf': 'wojtekmaj/react-pdf',
  '@tanstack/react-router': 'TanStack/router', '@tanstack/react-form': 'TanStack/form',
  'react-hotkeys-hook': 'JohannesKlawornn/react-hotkeys-hook',
  'use-debounce': 'xnimorz/use-debounce', 'react-responsive': 'yocontra/react-responsive',
  '@uidotdev/usehooks': 'uidotdev/usehooks', 'react-loading-skeleton': 'dvtng/react-loading-skeleton',
  'react-spinners': 'davidhu2000/react-spinners',
  'react-textarea-autosize': 'Andarist/react-textarea-autosize',
  'react-scroll': 'fisshy/react-scroll', 'react-countup': 'glennreyes/react-countup',
  'react-fast-marquee': 'justin-chu/react-fast-marquee',
  'react-type-animation': 'maxeth/react-type-animation',
  'react-confetti': 'alampros/react-confetti', 'react-lottie-player': 'mifi/react-lottie-player',
  'react-aria-components': 'adobe/react-spectrum', 'react-qr-code': 'rosskhanas/react-qr-code',
  'react-resizable-panels': 'bvaughn/react-resizable-panels',
  'input-otp': 'guilhermerodz/input-otp', 'react-json-view-lite': 'AnyRoad/react-json-view-lite',
  'react-dnd': 'react-dnd/react-dnd', '@mui/icons-material': 'mui/material-ui',
};

export function npmPkg(name) {
  if (NPM[name]) return NPM[name];
  if (name.startsWith('@') || name === name.toLowerCase()) return name;
  return name.toLowerCase().replace(/\s+/g, '-');
}

export const categories = ['All', ...new Set(pkgs.map(p => p.c))];

export const sortOrder = { pass: 0, partial: 1, expected: 2, investigating: 3 };
export const badgeMap = { pass: 'badge-pass', partial: 'badge-partial', investigating: 'badge-wip', expected: 'badge-expected' };
export const labelMap = { pass: 'Confirmed', partial: 'Partial', investigating: 'Investigating', expected: 'Expected' };
