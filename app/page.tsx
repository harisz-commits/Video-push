import { StudioShell } from "../components/StudioShell";
import europa from "../data/europa.json";
import quizFlaggen from "../data/quiz-flaggen.json";
import { QuizProject } from "../lib/quiz";
import { VideoProject } from "../lib/schema";

/**
 * The seed datasets are parsed on the server so a malformed data file fails the
 * build rather than the browser.
 */
export default function Page() {
  return (
    <StudioShell
      seed={VideoProject.parse(europa)}
      quizSeed={QuizProject.parse(quizFlaggen)}
    />
  );
}
