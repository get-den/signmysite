import { SignIn } from "../components/SignIn";
import { SignupHandleField } from "../components/SignupHandleField";
import { ProfileMock } from "../components/ProfileMock";
import { Footer } from "../components/Footer";

/**
 * The signed-out home: account first, website later. A username draft is persisted
 * before auth, then onboarding claims it and asks for the site as the next step.
 */
export function Landing() {
  return (
    <>
    <div className="land">
      <div className="land-hero">
        <h1>Your corner of the internet</h1>
        <p>One link for everything you make, and everyone who follows it. Your sites, your comments, and your people, tied into a single profile that's yours.</p>
        <div className="land-signup">
          <SignupHandleField />
          <SignIn returnTo="/" />
        </div>
      </div>
      <div className="land-art">
        <ProfileMock />
      </div>
    </div>
    <Footer />
    </>
  );
}
