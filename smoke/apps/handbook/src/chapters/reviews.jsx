import { ChapterPage } from '../chapter-page.jsx';

export default function Reviews() {
  return (
    <ChapterPage slug="reviews" title="Code review">
      <p>A review is a second pair of eyes on a change, not a gate. Review the change in front of you, and say which comments block it and which are suggestions.</p>
      <p>Small changes get better reviews. A change you cannot review in twenty minutes is usually two changes.</p>
      <ul>
        <li>Answer a review request within a working day.</li>
        <li>Approve when it is better than what is there.</li>
        <li>Explain the why, not only the what.</li>
      </ul>
    </ChapterPage>
  );
}
