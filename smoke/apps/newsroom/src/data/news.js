// The newsroom's content: 54 stories, each a long article, generated from a
// seed so the server, the browser and the smoke checks all derive the same
// text without shipping a database. Pure data and pure functions: safe to
// import anywhere.

export const STORY_COUNT = 54;
export const PER_PAGE = 6;
export const PAGE_COUNT = Math.ceil(STORY_COUNT / PER_PAGE);

export const SECTIONS = ['City', 'Climate', 'Economy', 'Science', 'Culture', 'Transit'];

const PLACES = ['Harbor District', 'the Northern Line', 'Eastfield', 'the river delta', 'Old Market', 'the port authority', 'Linden Heights', 'the county board'];
const SUBJECTS = ['tide gauges', 'night buses', 'the seawall', 'rooftop gardens', 'the grain exchange', 'a public library', 'heat pumps', 'the ferry schedule', 'bridge sensors', 'a school kitchen'];
const VERBS = ['rethinks', 'rebuilds', 'measures', 'reopens', 'funds', 'tests', 'maps', 'restores'];
const WORDS = (
  'the council said residents had waited years for a plan that would hold through another winter '
  + 'engineers walked the length of the site twice before the first survey was filed and every reading '
  + 'was checked against records kept since the district was first drawn on a map the budget leaves '
  + 'room for repairs but not for the expansion that neighbours asked for at three public meetings '
  + 'officials expect the work to take most of next year with crews rotating between the two shifts '
  + 'local businesses reported fewer deliveries during the closure and some moved their hours earlier '
  + 'a spokesperson for the agency declined to give a date but said the figures would be published '
  + 'researchers compared the data with neighbouring cities and found the pattern held in each of them'
).split(' ');

/** mulberry32: a small deterministic PRNG. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];

function sentence(rand, words) {
  const out = [];
  for (let i = 0; i < words; i++) out.push(pick(rand, WORDS));
  out[0] = out[0][0].toUpperCase() + out[0].slice(1);
  return `${out.join(' ')}.`;
}

function storyMeta(index) {
  const rand = rng(1000 + index);
  const subject = pick(rand, SUBJECTS);
  const place = pick(rand, PLACES);
  const verb = pick(rand, VERBS);
  const n = index + 1;
  const headline = `${place[0].toUpperCase()}${place.slice(1)} ${verb} ${subject}`;
  return {
    slug: `story-${String(n).padStart(2, '0')}`,
    index,
    headline: `${headline} (No. ${n})`,
    dek: `What changes for ${place} as the city ${verb} ${subject}, and who pays for it. Report ${n}.`,
    section: SECTIONS[index % SECTIONS.length],
    byline: `${pick(rand, ['Ada', 'Bo', 'Cyrus', 'Dara', 'Esme', 'Fen'])} ${pick(rand, ['Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Reyes', 'Hale'])}`,
    // Newest first: story 1 is the lead.
    publishedAt: Date.UTC(2026, 10, 26, 12, 0) - index * 3_600_000,
  };
}

const META = Array.from({ length: STORY_COUNT }, (_, i) => storyMeta(i));

export function storyList() {
  return META;
}

export function storyBySlug(slug) {
  return META.find((s) => s.slug === slug) ?? null;
}

/** The stories on a front-page page, 1-based. */
export function pageOfStories(page) {
  return META.slice((page - 1) * PER_PAGE, page * PER_PAGE);
}

/**
 * The full article: about 3,000 words in 48 paragraphs, eight subheads, three
 * pull quotes. Each paragraph carries an inline emphasis and a link, so the
 * body is several hundred elements and text nodes.
 */
export function articleBody(slug) {
  const meta = storyBySlug(slug);
  if (!meta) return null;
  const rand = rng(5000 + meta.index);
  const blocks = [];
  for (let section = 0; section < 8; section++) {
    blocks.push({ type: 'h2', id: `part-${section + 1}`, text: `${section + 1}. ${sentence(rand, 4).slice(0, -1)}` });
    for (let p = 0; p < 6; p++) {
      blocks.push({
        type: 'p',
        lead: sentence(rand, 22),
        em: sentence(rand, 6).slice(0, -1),
        link: { text: pick(rand, SUBJECTS), href: `/article/${META[(meta.index + section + p + 1) % STORY_COUNT].slug}` },
        tail: ` ${sentence(rand, 20)} ${sentence(rand, 14)}`,
      });
    }
    if (section % 3 === 1) blocks.push({ type: 'quote', text: sentence(rand, 16), source: meta.byline });
  }
  return { ...meta, blocks };
}

/** The "most read" rail for a front-page page: stories from other pages. */
export function mostReadFor(page) {
  const out = [];
  for (let i = 0; i < 5; i++) out.push(META[(page * 7 + i * 5) % STORY_COUNT]);
  return out.map((s, rank) => ({ rank: rank + 1, slug: s.slug, headline: s.headline }));
}

/** The markets brief: a fixed shape, figures derived from the page. */
export function marketsFor(page) {
  return ['Grain', 'Freight', 'Power'].map((name, i) => ({
    name,
    value: (100 + ((page * 13 + i * 7) % 40) + i / 10).toFixed(1),
  }));
}

export function formatDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
}
