import { ChapterPage } from '../chapter-page.jsx';

export default function Data() {
  return (
    <ChapterPage slug="data" title="Working with data">
      <p>Production data stays in production. Use the anonymised snapshot for development, and ask before you export anything.</p>
      <p>A migration runs forwards and backwards. Write the backwards step before you run the forwards one.</p>
      <ul>
        <li>Never edit production by hand.</li>
        <li>Back up before you migrate.</li>
        <li>Name tables for what they hold.</li>
      </ul>
    </ChapterPage>
  );
}
