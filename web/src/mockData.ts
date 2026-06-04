import type { Discovery, Site } from "./api";

function site(index: number, name: string, handle: string, reason: string, tags: string[]): Site {
  return {
    id: `mock:${handle}`,
    handle,
    name,
    url: `https://${handle}.example`,
    avatar: null,
    views: 2400 + index * 3100,
    thumbnail: null,
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
