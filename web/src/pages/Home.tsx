import { useViewer } from "../providers";
import { Loading } from "../ui";
import { Landing } from "./Landing";
import { Profile } from "./Profile";

export function Home() {
  const { viewer, loading } = useViewer();
  if (loading) return <Loading />;
  return viewer ? <Profile viewer={viewer} /> : <Landing />;
}
