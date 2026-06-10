import { DemoLink, JoinLink } from "./shared";

/**
 * Variant 8 — plain answers. Built for the exact person who said "I can't figure
 * out what it is": the headline is their question, answered in four lines.
 */

const QA: Array<[string, string]> = [
  ["What is it",
   "A guestbook for your website. A small badge sits in the corner of your site, and the people who read you sign it."],
  ["How does it get on my site",
   "You paste one line of HTML. That's the entire install."],
  ["What do I get",
   "You see who actually reads you. Real names with real sites, not a view counter. Follow them back, leave notes, build a webring."],
  ["What does it cost",
   "Nothing. It's free."],
];

export function V8() {
  return (
    <div className="lv lv-left lv-qa">
      <h1>What is signmysite?</h1>
      <dl>
        {QA.map(([q, a]) => (
          <div key={q} className="lv-qa-row">
            <dt>{q}</dt>
            <dd>{a}</dd>
          </div>
        ))}
      </dl>
      <div className="lv-cta-row">
        <JoinLink>Get the line</JoinLink>
        <DemoLink />
      </div>
    </div>
  );
}
