import { useViewer } from "../providers";
import { Loading } from "../ui";
import { Landing } from "./Landing";
import { Dashboard } from "./Dashboard";

export function Home() {
  const { viewer, loading } = useViewer();
  if (loading) return <Loading />;
  return viewer ? <Dashboard viewer={viewer} /> : <Landing />;
}
