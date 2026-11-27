import { ChapterPage } from '../chapter-page.jsx';

export default function Testing() {
  return (
    <ChapterPage slug="testing" title="Testing">
      <p>A test is worth what it would catch. Write the one that would have failed for the bug you just fixed, then the ones that describe what the code promises.</p>
      <p>Slow tests get skipped and flaky tests get ignored. Keep the suite fast and fix flakes the day they appear.</p>
      <ul>
        <li>Test behaviour, not implementation.</li>
        <li>One reason to fail per test.</li>
        <li>A red build is everyone's problem.</li>
      </ul>
    </ChapterPage>
  );
}
