/**
 * A static, decorative mock of a Den profile card — the visual that sits beside
 * the hero on the landing and on the sign-in panel. Purely presentational, so
 * it's hidden from assistive tech.
 */
export function ProfileMock() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-card">
        <div className="mock-id">
          <div className="mock-av thumb-4" />
          <div className="mock-meta">
            <div className="mock-name">Nikole Brake</div>
            <div className="mock-handle">den.com/@nikole</div>
          </div>
        </div>
        <div className="mock-rows">
          <div className="mock-row">Slow flow sessions</div>
          <div className="mock-row">Online courses</div>
          <div className="mock-row">Wellness retreats</div>
        </div>
        <div className="mock-notes">
          <span className="mock-note">loved the last retreat, see you next month</span>
          <span className="mock-note alt">🔥</span>
        </div>
      </div>
    </div>
  );
}
