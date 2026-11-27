import { ChapterPage } from '../chapter-page.jsx';

export default function Welcome() {
  return (
    <ChapterPage slug="welcome" title="Welcome">
      <p>This handbook is how the team works, written down by the people who do the work. It changes whenever the work does, so read it as a snapshot, not a contract.</p>
      <p>Each chapter stands on its own. Start with the ones your first weeks touch: being on call, shipping a deploy, and code review.</p>
      <ul>
        <li>Ask in the team channel before you search for an hour.</li>
        <li>Change this handbook when it is wrong.</li>
        <li>Write down what you had to ask.</li>
      </ul>
    </ChapterPage>
  );
}
