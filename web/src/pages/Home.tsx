import { useViewer } from "../providers";
import { Loading } from "../ui";
import { Landing } from "./Landing";
import { Dashboard } from "./Dashboard";
import { Onboarding } from "./Onboarding";

export function Home() {
  const { viewer, loading } = useViewer();
  if (loading) return <Loading />;
  if (!viewer) return <Landing />;
  if (!viewer.onboarded) return <Onboarding />; // new sign-ups pick a username + site first
  return <Dashboard viewer={viewer} />;
}
