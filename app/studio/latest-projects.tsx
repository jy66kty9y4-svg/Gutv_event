import HomeProjects from '../home-projects';
import { latestPublicStories } from '../server/vk';

export default function LatestProjects() {
  return <HomeProjects projects={latestPublicStories()} />;
}
