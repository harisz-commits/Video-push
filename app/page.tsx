import { Studio } from "../components/Studio";
import europa from "../data/europa.json";
import { VideoProject } from "../lib/schema";

/**
 * The seed dataset is parsed on the server so a malformed data file fails the
 * build rather than the browser.
 */
export default function Page() {
  const seed = VideoProject.parse(europa);
  return <Studio seed={seed} />;
}
