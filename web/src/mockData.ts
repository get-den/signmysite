import type { Discovery, Site } from "./api";

const colors = [
  ["#f7d6e0", "#f472b6", "#111111"],
  ["#ccfbf1", "#14b8a6", "#111827"],
  ["#dbeafe", "#60a5fa", "#0f172a"],
  ["#fef3c7", "#f97316", "#111111"],
  ["#ede9fe", "#8b5cf6", "#18181b"],
  ["#cffafe", "#06b6d4", "#0f172a"],
];

function image(title: string, index: number): string {
  const [bg, accent, ink] = colors[index % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640">
    <rect width="960" height="640" rx="46" fill="${bg}"/>
    <rect x="64" y="64" width="832" height="512" rx="38" fill="#fff" opacity=".52"/>
    <circle cx="${650 - index * 17}" cy="${180 + index * 12}" r="126" fill="${accent}"/>
    <rect x="116" y="374" width="430" height="58" rx="29" fill="${ink}"/>
    <rect x="116" y="462" width="${270 + index * 24}" height="34" rx="17" fill="${ink}" opacity=".42"/>
    <text x="116" y="552" font-family="Inter,Arial,sans-serif" font-size="40" font-weight="800" fill="${ink}">${title}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function site(index: number, name: string, handle: string, reason: string, tags: string[]): Site {
  return {
    id: `mock:${handle}`,
    handle,
    name,
    url: `https://${handle}.example`,
    avatar: null,
    bio: reason,
    views: 2400 + index * 3100,
    thumbnail: image(name, index),
    savedCount: 18 + index * 23,
    followerCount: 40 + index * 91,
    mutualCount: index % 4,
    reason,
    tags,
  };
}

export const mockFollowing: Site[] = [
  site(0, "Maya Chen", "maya", "Tiny games and cheerful CSS experiments", ["games", "drawing"]),
  site(1, "Leo Park", "leo", "Stop-motion, boards, paper shadows", ["film", "craft"]),
  site(2, "Priya Nair", "priya", "Browser synths and playful tools", ["music", "code"]),
  site(3, "Aeon Atlas", "aeon", "Visual notes on cities and signage", ["design", "cities"]),
];

export const mockDiscovery: Discovery = {
  saved: [
    site(4, "Orbit Garden", "orbit", "Saved for later", ["plants", "audio"]),
    site(5, "Pixel Pantry", "pixel", "Saved for later", ["food", "zines"]),
    site(6, "Soft Space", "softspace", "Saved for later", ["templates", "calm"]),
  ],
  mostSaved: [
    site(7, "Orbit Garden", "orbit", "142 saves all-time", ["plants", "audio"]),
    site(8, "Glowlog", "glowlog", "118 saves all-time", ["screenshots", "tools"]),
    site(9, "Soft Space", "softspace", "96 saves all-time", ["templates", "calm"]),
    site(10, "Noon Studio", "noon", "84 saves all-time", ["type", "portfolio"]),
  ],
  recommended: [
    site(11, "Fern Club", "fern", "3 mutual friends", ["maps", "garden"]),
    site(12, "Noon Studio", "noon", "Similar visual style", ["type", "portfolio"]),
    site(13, "Glowlog", "glowlog", "2 mutual friends", ["screenshots", "tools"]),
    site(14, "Soft Space", "softspace", "Based on saved sites", ["templates", "calm"]),
  ],
};
