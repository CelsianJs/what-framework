import { ChapterPage } from '../chapter-page.jsx';

export default function Incidents() {
  return (
    <ChapterPage slug="incidents" title="Running an incident">
      <p>An incident has one lead, who decides, and one scribe, who writes down what happened as it happens. Everyone else works on what the lead asks for.</p>
      <p>Declare early. An incident that turns out small costs a channel and a few minutes; one declared late costs the hour nobody coordinated.</p>
      <ul>
        <li>Name the lead in the first message.</li>
        <li>Post an update every thirty minutes, even when nothing changed.</li>
        <li>Write the review within a week.</li>
      </ul>
    </ChapterPage>
  );
}
