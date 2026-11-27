import { ChapterPage } from '../chapter-page.jsx';

export default function Deploys() {
  return (
    <ChapterPage slug="deploys" title="Shipping a deploy">
      <p>Every merge to main deploys to staging; production deploys go out from the release channel, one at a time, during working hours.</p>
      <p>Watch the dashboards for ten minutes after a deploy. Roll back first and investigate second.</p>
      <ul>
        <li>No deploys on Friday afternoon.</li>
        <li>One change per deploy when you can.</li>
        <li>A rollback is never a failure.</li>
      </ul>
    </ChapterPage>
  );
}
