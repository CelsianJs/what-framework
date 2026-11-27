import { ChapterPage } from '../chapter-page.jsx';

export default function Security() {
  return (
    <ChapterPage slug="security" title="Security basics">
      <p>Secrets live in the vault, never in the repository, a ticket or a chat message. If one leaks, rotate it first and tell security second.</p>
      <p>Every service authenticates every request, including the ones from other services inside the network.</p>
      <ul>
        <li>Use the password manager.</li>
        <li>Turn on hardware keys.</li>
        <li>Report anything odd, even if you are not sure.</li>
      </ul>
    </ChapterPage>
  );
}
