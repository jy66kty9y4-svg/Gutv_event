import PublicHome from './public-home';
import { publicSession } from './server/public-session';
import { publicPageMetadata } from './seo';

export const metadata = publicPageMetadata('/');

export default async function Home() {
  return <PublicHome initialSession={await publicSession()} />;
}
