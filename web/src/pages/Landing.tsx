import { authUrl } from "../lib";
import { ProfileMock } from "../components/ProfileMock";

/**
 * The signed-out home: a left-aligned hero (headline + one "Join now" CTA) with
 * a mock profile card alongside. Sign-in itself lives on the dedicated /auth
 * page — the landing just funnels there.
 */
export function Landing() {
  return (
    <div className="land">
      <div className="land-hero">
        <h1>Your corner of the internet</h1>
        <p>One link for everything you make, and everyone who follows it. Your sites, your notes, and your people, tied into a single profile that's yours.</p>
        <a className="btn pink lg" href={authUrl()}>Join now</a>
      </div>
      <div className="land-art">
        <ProfileMock />
      </div>
    </div>
  );
}
