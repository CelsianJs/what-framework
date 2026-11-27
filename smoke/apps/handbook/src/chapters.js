// The handbook's table of contents. Each chapter is its own module under
// ./chapters, built into a chunk of its own and loaded the first time a
// reader opens it (routes.jsx).

export const CHAPTERS = [
  { slug: 'welcome', title: 'Welcome', part: 'Start here' },
  { slug: 'on-call', title: 'Being on call', part: 'Operations' },
  { slug: 'incidents', title: 'Running an incident', part: 'Operations' },
  { slug: 'reviews', title: 'Code review', part: 'Engineering' },
  { slug: 'deploys', title: 'Shipping a deploy', part: 'Operations' },
  { slug: 'security', title: 'Security basics', part: 'Engineering' },
  { slug: 'testing', title: 'Testing', part: 'Engineering' },
  { slug: 'observability', title: 'Observability', part: 'Operations' },
  { slug: 'data', title: 'Working with data', part: 'Engineering' },
  { slug: 'writing', title: 'Writing things down', part: 'Culture' },
  { slug: 'hiring', title: 'Interviewing', part: 'Culture' },
  { slug: 'leaving', title: 'Handing over', part: 'Culture' },
];

export const chapterPath = (slug) => `/handbook/${slug}`;
