import { Review } from './routes/Review';

export function App() {
  const reviewMatch = /^\/review\/([^/]+)/.exec(window.location.pathname);
  if (!reviewMatch) {
    return (
      <main className="empty-shell">
        <section className="empty-panel">
          <h1>Gloss</h1>
          <p>Open a review from the CLI with `gloss open`.</p>
        </section>
      </main>
    );
  }

  return <Review reviewId={reviewMatch[1]} />;
}
