import { MarketingHome } from './routes/MarketingHome';
import { Review } from './routes/Review';
import { SetupPage } from './routes/SetupPage';

export function App() {
  if (window.location.pathname === '/setup' || window.location.pathname === '/setup/') {
    return <SetupPage />;
  }

  const reviewMatch = /^\/review\/([^/]+)/.exec(window.location.pathname);
  if (!reviewMatch) {
    return <MarketingHome />;
  }

  return <Review reviewId={reviewMatch[1]} />;
}
