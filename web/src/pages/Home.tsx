import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useViewer } from "../providers";
import { Loading } from "../ui";
import { loadPending, clearPending, resumePath } from "../pending";
import { Landing } from "./Landing";
import { HomeFeed } from "../home";
import { Onboarding } from "./Onboarding";

export function Home() {
  const { viewer, loading } = useViewer();
  const navigate = useNavigate();
  const [resuming, setResuming] = useState(false);

  // Backstop for "no data ever lost": a reaction/comment begun on a friend's site
  // that hasn't posted yet (e.g. a mobile sign-in round trip that didn't land back
  // on the compose page) is stashed durably. If a signed-in member arrives here
  // with one outstanding, resume it on the page that finishes it. We clear the
  // stash as we go — its data rides in the resume URL — so this fires at most once.
  useEffect(() => {
    if (loading || !viewer) return;
    const pending = loadPending();
    if (!pending) return;
    clearPending();
    setResuming(true);
    navigate(resumePath(pending), { replace: true });
  }, [loading, viewer, navigate]);

  if (loading || resuming) return <Loading />;
  if (!viewer) return <Landing />;
  if (!viewer.onboarded) return <Onboarding />; // new sign-ups pick a username + site first
  return <HomeFeed viewer={viewer} />;
}
