export function UploadPanel() {
  return (
    <section className="card">
      <h2>Upload a game</h2>
      <p className="muted">Coming soon. This is where you'll add your own game:</p>
      <ol className="steps">
        <li>
          <strong>Upload the rules</strong> (PDF, Word or text) and <strong>the card list</strong> (a spreadsheet, one row per card).
        </li>
        <li>
          <strong>Answer a few questions</strong> Claude asks about anything unclear in the rules.
        </li>
        <li>
          <strong>Watch one sample game</strong> to check it plays the way you expect, then simulate it like the built-in games.
        </li>
      </ol>
      <div className="dropzone muted" aria-disabled="true">
        Rules and card files will go here
      </div>
    </section>
  );
}
