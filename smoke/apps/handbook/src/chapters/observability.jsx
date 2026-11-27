import { ChapterPage } from '../chapter-page.jsx';

export default function Observability() {
  return (
    <ChapterPage slug="observability" title="Observability">
      <p>If you cannot see it, you cannot run it. Every service exports request rate, error rate and latency, and logs a line per request with its trace id.</p>
      <p>Alerts page a person only when a person has to act now. Everything else goes to a dashboard or a daily digest.</p>
      <ul>
        <li>Alert on symptoms, not causes.</li>
        <li>Every alert links to a runbook.</li>
        <li>Delete an alert nobody acted on for a month.</li>
      </ul>
    </ChapterPage>
  );
}
