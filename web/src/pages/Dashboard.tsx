import type { Member } from "../api";
import { HomeExperience } from "../home";

/**
 * The logged-in home. The page itself is now a thin entry point: it hands the
 * viewer to the home experience, which loads the graph once and lets you switch
 * between four layouts (Brief / Stream / Orbit / Gallery). All of the structure
 * lives in web/src/home/.
 */
export function Dashboard({ viewer }: { viewer: Member }) {
  return <HomeExperience viewer={viewer} />;
}
