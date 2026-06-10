import { CopyCta, Faces, PEOPLE } from "./shared";

/**
 * Variant 4 — three steps. The hero is the mechanism: paste, get signed, get
 * connected. Each step is one line plus the smallest possible visual.
 */
export function V4() {
  return (
    <div className="lv">
      <h1>One line. Three things happen.</h1>
      <ol className="lv-steps">
        <li>
          <span className="lv-step-n">1</span>
          <h2>You paste the line</h2>
          <code className="lv-step-code">&lt;script src=".../w/<b>you</b>.js"&gt;</code>
          <p>On any site, any builder. That's the install.</p>
        </li>
        <li>
          <span className="lv-step-n">2</span>
          <h2>Readers sign your site</h2>
          <span className="lv-step-art">
            <Faces n={4} size={30} />
            <span className="lv-bubble">loved this post</span>
          </span>
          <p>A guestbook of real people, not a view counter.</p>
        </li>
        <li>
          <span className="lv-step-n">3</span>
          <h2>Sites link together</h2>
          <span className="lv-step-art lv-chain">
            {PEOPLE.slice(1, 4).map((p) => (
              <img key={p.handle} src={p.avatar} alt="" title={p.site} loading="lazy" />
            ))}
            <span className="lv-chain-you">you</span>
          </span>
          <p>Yours joins a web of personal sites you can wander.</p>
        </li>
      </ol>
      <CopyCta />
    </div>
  );
}
