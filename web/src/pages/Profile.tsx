import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getFollowing, getStats, type Member, type Stats } from "../api";
import { Avatar, BlogRow } from "../ui";
import { compact, host } from "../lib";

/** The signed-in member's home: identity, stats, and the blogs they follow. */
export function Profile({ viewer }: { viewer: Member }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [following, setFollowing] = useState<Member[]>([]);

  useEffect(() => {
    let alive = true;
    getStats(viewer.id)
      .then((s) => alive && setStats(s))
      .catch(() => {});
    getFollowing()
      .then((f) => alive && setFollowing(f))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [viewer.id]);

  return (
    <>
      <div className="phead">
        <Avatar of={viewer} />
        <div>
          <div className="pname">{viewer.name || "You"}</div>
          <div className="phandle">@{viewer.handle || ""}</div>
          {viewer.url && (
            <div className="purl">
              <a href={viewer.url} target="_blank" rel="noopener">
                {host(viewer.url)}
              </a>
            </div>
          )}
        </div>
      </div>

      {viewer.bio && <p className="pbio">{viewer.bio}</p>}

      <div className="pstats">
        <Stat n={stats?.views} label="Views" />
        <Stat n={stats?.followers} label="Followers" />
        <Stat n={stats?.following} label="Following" />
      </div>

      <div className="row">
        <Link className="btn" to="/edit">
          Edit profile
        </Link>
        <Link className="btn" to="/embed">
          Get your widget
        </Link>
        {viewer.handle && (
          <a className="btn" href={`/@${viewer.handle}`} target="_blank" rel="noopener">
            View public page ↗
          </a>
        )}
      </div>

      <div className="section">
        <h2>Blogs you follow</h2>
        {following.length ? (
          following.map((b) => <BlogRow key={b.id} blog={b} />)
        ) : (
          <div className="empty">You don't follow anyone yet. Visit a Den site and tap Follow.</div>
        )}
      </div>
    </>
  );
}

function Stat({ n, label }: { n: number | undefined; label: string }) {
  return (
    <div>
      <span className="n">{compact(n)}</span> <span className="l">{label}</span>
    </div>
  );
}
