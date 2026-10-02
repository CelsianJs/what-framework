import { buildGuideUrl, publishedTemplates, RUNTIME_LABELS, sourceUrl } from './catalog.mjs';
import { learningFor } from './learning.mjs';
import { PHASE_LABELS, publicStatus, RESULT_LABELS, statusPath } from './status.mjs';

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function shell({ title, description, version, body, canonical }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escape(title)} · What Framework</title>
  <meta name="description" content="${escape(description)}">
  <link rel="canonical" href="https://whatfw.com${canonical}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/design-system.css">
  <link rel="stylesheet" href="/templates/gallery.css">
  <script src="/theme.js"></script>
  <script src="/templates/gallery.js" type="module"></script>
</head>
<body class="templates-page">
  <a class="templates-skip" href="#main">Skip to content</a>
  <header class="templates-nav">
    <a class="templates-logo" href="/">What <span class="templates-version">v${escape(version)}</span></a>
    <nav aria-label="Main navigation">
      <a href="/docs">Docs</a>
      <a href="/templates"${canonical === '/templates' ? ' aria-current="page"' : ''}>Templates</a>
      <a href="/templates/status"${canonical.startsWith('/templates/status') ? ' aria-current="page"' : ''}>Build status</a>
      <a href="/templates/agents"${canonical === '/templates/agents' ? ' aria-current="page"' : ''}>For agents</a>
    </nav>
    <button class="theme-toggle" type="button" aria-label="Toggle theme">
      <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>
      <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>
    </button>
  </header>
  <main id="main" class="templates-main">${body}</main>
  <footer class="templates-footer">
    <a class="templates-logo" href="/">What Framework</a>
    <nav aria-label="Footer navigation"><a href="/docs/learn/">Learn What</a><a href="/templates/agents">Build with an agent</a><a href="/templates/status">Starter build status</a><a href="https://github.com/CelsianJs/what-framework">Framework source</a></nav>
    <p>v${escape(version)} · MIT License</p>
  </footer>
</body>
</html>`;
}

function card(template) {
  const repo = sourceUrl(template);
  const search = [template.name, template.category, template.description, template.architecture, ...template.features, ...template.runtimes].join(' ').toLowerCase();
  return `<article class="template-card" data-template data-search="${escape(search)}" data-runtimes="${escape(template.runtimes.join(' '))}">
    <a class="template-preview" href="${escape(template.release.demoUrl)}" aria-label="Open ${escape(template.name)} live demo">
      <img src="${escape(template.preview.src)}" alt="${escape(template.preview.alt)}" width="${template.preview.width}" height="${template.preview.height}" loading="lazy" decoding="async">
    </a>
    <div class="template-card-body">
      <div class="template-kicker"><span>${escape(template.category)}</span><span>Hosted on Vura</span></div>
      <h2>${escape(template.name)}</h2>
      ${template.preview.capturedAt ? `<p class="template-capture-date">Preview captured ${time(template.preview.capturedAt)}</p>` : ''}
      <p class="template-description">${escape(template.description)}</p>
      <p class="template-architecture">${escape(template.architecture)}</p>
      <ul class="template-tags" aria-label="Rendering model">${template.runtimes.map(runtime => `<li>${escape(RUNTIME_LABELS[runtime])}</li>`).join('')}</ul>
      <ul class="template-features" aria-label="Framework features">${template.features.map(feature => `<li>${escape(feature)}</li>`).join('')}</ul>
      <div class="template-actions"><a class="templates-button templates-button-primary" href="${escape(template.release.demoUrl)}">Open demo <span aria-hidden="true">↗</span></a><a class="templates-button" href="${repo}">Source</a><a class="templates-button" href="${escape(template.release.buildUrl)}">How it’s built</a></div>
      <details class="template-clone"><summary>Use this starter</summary><p>Clone it, install the locked dependencies and follow the repository README.</p><div class="template-command"><code>git clone ${repo}.git<br>cd ${escape(template.slug)}<br>npm ci<br>npm run dev</code><button type="button" data-copy="${escape(`git clone ${repo}.git\ncd ${template.slug}\nnpm ci\nnpm run dev`)}" aria-label="Copy ${escape(template.name)} clone commands">Copy</button></div><a class="template-guide-link" href="${buildGuideUrl(template)}">Read BUILD.md: patterns, source map and limitations →</a></details>
    </div>
  </article>`;
}

export function renderGallery(catalog, version) {
  const templates = publishedTemplates(catalog);
  const runtimes = Object.entries(RUNTIME_LABELS).filter(([key]) => templates.some(template => template.runtimes.includes(key)));
  const gallery = templates.length ? `<section class="templates-catalog" aria-label="Starter catalog">
    <form class="templates-controls" role="search" data-gallery-controls hidden>
      <div class="templates-search"><label for="template-search">Find a starter</label><input id="template-search" type="search" name="q" placeholder="Try recipes, signals or dashboards" autocomplete="off"></div>
      <div class="templates-filter"><label for="template-runtime">Rendering model</label><select id="template-runtime" name="runtime"><option value="all">All models</option>${runtimes.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></div>
    </form>
    <p class="templates-count" data-result-count role="status" aria-live="polite">${templates.length} ${templates.length === 1 ? 'starter' : 'starters'}</p>
    <div class="templates-grid">${templates.map(card).join('')}</div>
    <div class="templates-no-matches" data-no-matches hidden><h2>No matching starters</h2><p>Try a different product, feature or rendering model.</p><button class="templates-button" type="button" data-reset>Reset filters</button></div>
  </section>` : `<section class="templates-start"><h2>Start with a working pattern</h2><p>Use the framework’s setup and tutorials to build a new app, or read the agent workflow before adapting a reference.</p><div class="templates-start-links"><a href="/docs/learn/">Create your first app →</a><a href="/docs/tutorial/">Build the complete tutorial →</a><a href="/templates/agents">Use a reference with an agent →</a></div></section>`;
  return shell({ title: 'Starter templates', description: 'Explore working What Framework starters: live apps, public source and practical build guides, hosted on Vura.', version, canonical: '/templates', body: `
    <section class="templates-intro"><p class="templates-eyebrow">The starter library</p><h1>Start with something<br>worth building on.</h1><p class="templates-lede">Working products, not isolated snippets. Explore the app, read the source and understand the What patterns behind it.</p><div class="templates-intro-links"><a href="/templates/agents">Building with an agent? Start here →</a><a href="/templates/status">Follow every starter’s build status →</a><a href="/templates/llms.txt">Machine-readable index ↗</a></div></section>
    ${gallery}
    <aside class="templates-reference"><div><p class="templates-eyebrow">Look under the hood</p><h2>The explanation is part of the starter.</h2><p>Each published demo links to its own build guide: signals and effects, global state, routing, deployment, and the tradeoffs that matter when you make it yours.</p></div><a class="templates-button" href="/templates/agents">Read the agent workflow →</a></aside>` });
}

export function renderAgentGuide(catalog, version) {
  const templates = publishedTemplates(catalog);
  return shell({ title: 'Build from a starter with an agent', description: 'A practical workflow for adapting What Framework starter apps using their source maps, BUILD.md and runtime boundaries.', version, canonical: '/templates/agents', body: `
    <section class="templates-intro"><p class="templates-eyebrow">For developers and agents</p><h1>Read the pattern.<br>Then make it yours.</h1><p class="templates-lede">A starter is a runnable reference, not an instruction to copy every decision. Begin with its documented behavior and keep the parts your product actually needs.</p><a class="template-guide-link" href="/templates">← Explore the starter library</a></section>
    <section class="templates-agent-body"><h2>A reproducible starting path</h2><ol class="templates-agent-steps">
      <li><h3>Explore the real app</h3><p>Exercise the workflow you want to reuse. Open its <code>/build</code> page to see the architecture and storage boundaries. Check whether data is local, seeded, server-backed or durable.</p></li>
      <li><h3>Read the repository before editing</h3><p>Read <code>README.md</code> for setup and verification, then <code>BUILD.md</code> for the source map, signal dependencies, effect cleanup, shared state, routes and known issues. Use the repository’s <code>AGENTS.md</code> where provided.</p></li>
      <li><h3>Run the unchanged baseline</h3><p>Clone the public repository, use its documented Node version, run <code>npm ci</code> and follow its check/build scripts. Verify the documented workflow locally before introducing changes. Never copy secrets or project-specific deployment links.</p></li>
      <li><h3>Adapt one behavior at a time</h3><p>Keep derived values derived, clean up timers and listeners, and avoid snapshotting signal reads outside reactive expressions. Respect the split between client-compiled JSX and server-safe JSX. Test keyboard use, routing, mobile layout and reduced motion.</p></li>
      <li><h3>Deploy your own project</h3><p>Run the repository’s complete build, then use <code>npx vura-platform@0.3.0 projects create your-app --team &lt;your-team-id&gt;</code> to create and link an isolated project. Use <code>npx vura-platform@0.3.0 deploy --prod</code> only after checking the build. The deploy command uploads <code>dist/</code>; it does not build it for you.</p></li>
    </ol>
    <div class="templates-boundary"><h3>Rendering is an architectural choice</h3><p>A static page, a client application, a hybrid page and a serverless endpoint have different guarantees. A client guard is not backend authorization. Browser storage is not a team database. Process memory is not durable storage. Read the starter’s limits before turning a demo into production.</p></div>
    <h2>Reference library</h2>${templates.length ? `<ul class="templates-agent-library">${templates.map(template => `<li><div><h3>${escape(template.name)}</h3><p>${escape(template.architecture)}</p></div><a href="${buildGuideUrl(template)}">BUILD.md ↗</a><a href="${escape(template.release.buildUrl)}">In-app guide ↗</a></li>`).join('')}</ul>` : '<p class="templates-description">The framework guides below explain the same primitives used by the starter library.</p>'}
    <div class="templates-learn-links"><a href="/docs/learn/signals">Signals</a><a href="/docs/learn/effects">Effects and cleanup</a><a href="/docs/learn/stores">Global stores</a><a href="/docs/learn/routing">Routing</a><a href="/docs/learn/islands">Islands</a><a href="/docs/learn/deployment">Deployment</a></div>
    <p class="templates-index-links">For retrieval: <a href="/templates/llms.txt">starter index</a> · <a href="/templates/catalog.json">verified release metadata</a> · <a href="/templates/status">build status and journals</a> · <a href="/llms.txt">framework reference index</a>.</p></section>` });
}

function time(value) {
  return `<time datetime="${escape(value)}">${escape(new Date(value).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'))}</time>`;
}

function phaseBadge(phase) {
  return `<span class="template-phase template-phase-${phase}">${escape(PHASE_LABELS[phase])}</span>`;
}

function phaseTrack(currentPhase) {
  const phases = Object.entries(PHASE_LABELS);
  const current = phases.findIndex(([phase]) => phase === currentPhase);
  return `<ol class="templates-phase-track" aria-label="Build phases">${phases.map(([phase, label], index) => {
    const state = index < current ? 'complete' : index === current ? 'current' : 'upcoming';
    const stateLabel = state === 'complete' ? 'Complete' : state === 'current' ? 'Current phase' : 'Not reached';
    return `<li data-phase-state="${state}"${phase === currentPhase ? ' aria-current="step"' : ''}><span class="templates-step-marker" aria-hidden="true">${state === 'complete' ? '✓' : index + 1}</span><span><span class="templates-step-label">${escape(label)}</span><span class="templates-step-state">${stateLabel}</span></span></li>`;
  }).join('')}</ol>`;
}

function referenceLinks(entry) {
  const source = entry.sourceUrl ? `<a class="templates-button" href="${escape(entry.sourceUrl)}">Public source</a><a class="templates-button" href="${escape(entry.buildGuideUrl)}">BUILD.md</a>` : '<p class="templates-description">Repository name reserved; a public implementation is not available yet.</p>';
  const live = entry.demoUrl ? `<a class="templates-button templates-button-primary" href="${escape(entry.demoUrl)}">Open verified demo ↗</a><a class="templates-button" href="${escape(entry.inAppGuideUrl)}">In-app build guide</a>` : '<p class="templates-description">No verified live demo yet.</p>';
  return `<div class="template-status-links">${source}${live}</div>`;
}

function sourceMap(learning) {
  if (!learning) return '';
  return `<h3>Source map</h3><div class="templates-source-map">${learning.sourceFiles.map(source => `<article><p class="templates-eyebrow">${escape(source.label)}</p><code>${escape(source.path)}</code><p>${escape(source.note)}</p></article>`).join('')}</div>`;
}

function codeExample(example) {
  return `<article class="templates-code-example"><div><h3>${escape(example.title)}</h3><p class="templates-updated">${escape(example.path)}</p><p>${escape(example.notes)}</p></div><pre><code class="language-${escape(example.language)}">${escape(example.code)}</code></pre></article>`;
}

function issueExample(issue) {
  const beforeAfter = issue.before || issue.after ? `<div class="templates-before-after">${issue.before ? `<div><p class="templates-eyebrow">Before</p><pre><code>${escape(issue.before)}</code></pre></div>` : ''}${issue.after ? `<div><p class="templates-eyebrow">After</p><pre><code>${escape(issue.after)}</code></pre></div>` : ''}</div>` : '';
  return `<article class="templates-issue"><h3>${escape(issue.title)}</h3><dl><div><dt>Problem</dt><dd>${escape(issue.problem)}</dd></div><div><dt>Fix</dt><dd>${escape(issue.fix)}</dd></div><div><dt>Proof</dt><dd>${escape(issue.proof)}</dd></div><div><dt>Takeaway</dt><dd>${escape(issue.takeaway)}</dd></div></dl>${beforeAfter}</article>`;
}

function renderLearningJournal(reference) {
  const learning = learningFor(reference.slug);
  if (!learning) {
    return `<h2>Learning journal</h2><p class="templates-description">No source-level learning notes have been recorded for this starter yet. Status facts above remain the source of truth until implementation evidence is available.</p>`;
  }
  return `<h2>Learning journal</h2><section class="templates-learning" aria-labelledby="learning-${escape(reference.slug)}">
    <div class="templates-boundary"><h3 id="learning-${escape(reference.slug)}">How to read this starter</h3><p>${escape(learning.overview)}</p></div>
    ${sourceMap(learning)}
    <h3>Code patterns worth copying</h3><div class="templates-code-grid">${learning.examples.map(codeExample).join('')}</div>
    <h3>Real issues and fixes</h3><div class="templates-issues">${learning.issues.map(issueExample).join('')}</div>
    <h3>What went smoothly</h3><ul class="templates-status-list">${learning.smooth.map(value => `<li>${escape(value)}</li>`).join('')}</ul>
    <h3>Boundaries to preserve</h3><ul class="templates-status-list">${learning.boundaries.map(value => `<li>${escape(value)}</li>`).join('')}</ul>
  </section>`;
}

export function renderStatusOverview(status, catalog, version) {
  const data = publicStatus(status, catalog);
  const counts = Object.keys(PHASE_LABELS).map(phase => ({ phase, count: data.entries.filter(entry => entry.phase === phase).length }));
  return shell({ title: 'Starter build status', description: 'Honest build progress, verification summaries and implementation journals for every What Framework starter.', version, canonical: '/templates/status', body: `
    <section class="templates-intro templates-status-intro"><p class="templates-eyebrow">Build in the open</p><h1>Starter build status.</h1><p class="templates-lede">All ${data.entries.length} products, from planned work to verified releases. Open a journal for recorded checks, implementation lessons and limitations.</p><p class="templates-updated">Last update: ${time(data.updatedAt)}</p><div class="templates-intro-links"><a href="/templates">Verified releases →</a><a href="/templates/status/llms.txt">Agent status index ↗</a><a href="/templates/status.json">Status JSON ↗</a></div></section>
    <section class="templates-status-refresh" data-status-watch data-snapshot-updated="${escape(data.updatedAt)}" aria-label="Status refresh" hidden><div><p data-status-watch-message role="status" aria-live="polite">This is the latest published snapshot. Checking for updates…</p><p class="templates-updated">Last successful check: <span data-status-last-checked>Not checked yet</span>. Checks run every minute while online.</p></div><button class="templates-button" type="button" data-status-refresh>Refresh status</button></section>
    <script id="starter-status-snapshot" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
    <dl class="templates-phase-counts">${counts.map(({ phase, count }) => `<div><dt>${escape(PHASE_LABELS[phase])}</dt><dd data-phase-count="${phase}">${count}</dd></div>`).join('')}</dl>
    <form class="templates-controls" data-status-controls hidden role="search"><div class="templates-search"><label for="status-search">Find a product or pattern</label><input id="status-search" name="q" type="search" placeholder="Try music, travel or server rendering" autocomplete="off"></div><div class="templates-filter"><label for="status-phase">Build phase</label><select id="status-phase" name="phase"><option value="all">All phases</option>${Object.entries(PHASE_LABELS).map(([phase, label]) => `<option value="${phase}">${escape(label)}</option>`).join('')}</select></div></form>
    <p class="templates-count" data-status-count role="status" aria-live="polite">${data.entries.length} starters tracked</p>
    <div class="templates-status-grid">${data.entries.map(entry => `<article class="template-status-card" data-status-entry data-phase="${entry.phase}" data-search="${escape([entry.name, entry.description, entry.category, ...entry.intendedFeatures, entry.intendedArchitecture].join(' ').toLowerCase())}"><div class="template-kicker"><span>${escape(entry.category)}</span>${phaseBadge(entry.phase)}</div><h2><a href="${entry.referencePath}">${escape(entry.name)}</a></h2><p>${escape(entry.description)}</p><p class="template-status-summary">${escape(entry.summary)}</p><p class="templates-updated">Updated ${time(entry.updatedAt)}</p><a class="template-guide-link" href="${entry.referencePath}">Read status, evidence and build journal →</a></article>`).join('')}</div>
    <div class="templates-no-matches" data-status-empty hidden><h2>No matching starters</h2><p>Try another product or build phase.</p><button class="templates-button" type="button" data-status-reset>Reset filters</button></div>
    <aside class="templates-reference"><div><p class="templates-eyebrow">Read the evidence</p><h2>Progress is not a production claim.</h2><p>A local build is not a hosted release. A reported result is not an independently reproduced check. Source links appear only after public code is verified, and live links only after a matching deployment is verified.</p></div><a class="templates-button" href="/templates/agents">Agent workflow →</a></aside>` });
}

export function renderStatusReference(entry, catalog, status, version) {
  const reference = publicStatus(status, catalog).entries.find(value => value.slug === entry.slug);
  const template = catalog.templates.find(value => value.slug === entry.slug);
  const preview = reference.phase === 'live' && template.status === 'published' ? `<figure class="template-reference-preview"><a href="${escape(reference.demoUrl)}" aria-label="Open ${escape(reference.name)} live product"><img src="${escape(template.preview.src)}" alt="${escape(template.preview.alt)}" width="${template.preview.width}" height="${template.preview.height}" loading="lazy" decoding="async"></a><figcaption>${template.preview.capturedAt ? `Preview captured ${time(template.preview.capturedAt)}` : 'Recorded release preview'} · <a href="${escape(reference.demoUrl)}">Explore the product ↗</a></figcaption></figure>` : '';
  const bulletList = (values, empty) => values.length ? `<ul class="templates-status-list">${values.map(value => `<li>${escape(value)}</li>`).join('')}</ul>` : `<p class="templates-description">${escape(empty)}</p>`;
  return shell({ title: `${reference.name}: build status and reference`, description: `${reference.name} starter: actual build phase, verification summaries, implementation lessons and release boundaries.`, version, canonical: statusPath(entry), body: `
    <section class="templates-intro template-reference-hero"><div><a class="template-guide-link" href="/templates/status">← All starter build updates</a><p class="templates-eyebrow template-status-eyebrow">${escape(reference.category)} starter</p><h1>${escape(reference.name)}</h1><p class="templates-lede">${escape(reference.description)}</p><div class="template-status-heading">${phaseBadge(reference.phase)}<span class="templates-updated">Updated ${time(reference.updatedAt)}</span></div><p class="template-status-summary">${escape(reference.summary)}</p>${referenceLinks(reference)}</div>${preview}</section>
    <section class="templates-status-body"><h2>Build phase</h2>${phaseTrack(reference.phase)}<p class="templates-updated">This tracks the recorded release phase. The checks below include later findings and ongoing refinements.</p>
    <h2>Product scope and intended patterns</h2><p class="templates-description">The following describes the intended reference. Features are not a verification claim; recorded check results below define what has actually been tested.</p><p>${escape(reference.intendedArchitecture)}</p><ul class="template-tags" aria-label="Intended rendering model">${reference.intendedRuntimes.map(runtime => `<li>${escape(RUNTIME_LABELS[runtime])}</li>`).join('')}</ul><ul class="template-features" aria-label="Intended framework features">${reference.intendedFeatures.map(feature => `<li>${escape(feature)}</li>`).join('')}</ul>
    ${renderLearningJournal(reference)}
    <h2>Verification record</h2>${reference.verification.length ? `<ul class="templates-checks">${reference.verification.map(check => `<li><div><h3>${escape(check.label)}</h3><span class="template-check-result template-check-${check.result}">${escape(RESULT_LABELS[check.result])}</span></div><p>${escape(check.details)}</p><p class="templates-updated">${time(check.at)}</p></li>`).join('')}</ul>` : '<p class="templates-description">No implementation, test or deployment results have been recorded yet.</p>'}
    <h2>Build journal</h2><ol class="templates-journal">${[...reference.journal].reverse().map(event => `<li><p class="templates-updated">${time(event.at)} · ${escape(PHASE_LABELS[event.phase])}</p><h3>${escape(event.title)}</h3><p>${escape(event.summary)}</p></li>`).join('')}</ol>
    <h2>Implementation lessons</h2>${bulletList(reference.lessons, 'No implementation lessons have been recorded yet. We do not fill this section with assumed issues or generic build history.')}
    <h2>Known limitations</h2>${bulletList(reference.limitations, 'No limitations have been recorded; this does not imply that none exist.')}
    <h2>Remaining work and blockers</h2>${bulletList(reference.blockers, reference.phase === 'live' ? 'No release blockers are recorded for this snapshot.' : 'No specific blocker is recorded. Work and release verification are not complete.')}
    <div class="templates-boundary"><h3>Using this as an agent reference</h3><p>${reference.sourceUrl ? 'Read the public README and BUILD.md, reproduce the recorded checks and inspect the source before adapting the starter. A live demo, where available, provides separate deployed evidence.' : 'This page documents scope and progress; it is not yet a runnable source reference. Use the framework guides until public implementation and build instructions are published.'}</p></div><div class="templates-learn-links"><a href="/templates/agents">Agent workflow</a><a href="/docs/learn/signals">Signals</a><a href="/docs/learn/effects">Effects</a><a href="/docs/learn/stores">Global state</a><a href="/docs/learn/routing">Routing</a></div></section>` });
}
