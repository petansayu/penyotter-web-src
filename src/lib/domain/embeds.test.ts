import { describe, expect, it } from "vitest";
import { EMBED_ORIGINS, embedOf, embedsIn } from "./embeds";
import headers from "../../../public/_headers?raw";

describe("埋め込み", () => {
  it("YouTube（watch・youtu.be・shorts・開始時刻）", () => {
    expect(embedOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")).toMatchObject({
      service: "youtube", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90", aspect: 9 / 16, thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    expect(embedOf("https://youtu.be/dQw4w9WgXcQ?t=42")?.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42");
    expect(embedOf("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toMatchObject({ label: "YouTube ショート", aspect: 16 / 9 });
    expect(embedOf("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(embedOf("https://www.youtube.com/@channel")).toBeNull();
  });

  it("X・Spotify・SoundCloud・ニコニコ・Vimeo・TikTok・Instagram", () => {
    expect(embedOf("https://x.com/jack/status/20")?.src).toBe("https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true");
    expect(embedOf("https://twitter.com/jack/status/20/photo/1")?.service).toBe("x");
    expect(embedOf("https://x.com/jack")).toBeNull();
    expect(embedOf("https://open.spotify.com/intl-ja/track/4uLU6hMCjMI75M1A2tKUQC?si=x")).toMatchObject({ src: "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC", height: 152 });
    expect(embedOf("https://soundcloud.com/artist/song?in=x")?.src).toBe("https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Fsong&visual=false");
    expect(embedOf("https://www.nicovideo.jp/watch/sm9")?.src).toBe("https://embed.nicovideo.jp/watch/sm9");
    expect(embedOf("https://nico.ms/sm9")?.service).toBe("niconico");
    expect(embedOf("https://vimeo.com/76979871")?.src).toBe("https://player.vimeo.com/video/76979871?dnt=1");
    expect(embedOf("https://www.tiktok.com/@user/video/7100000000000000000")?.src).toBe("https://www.tiktok.com/embed/v2/7100000000000000000");
    expect(embedOf("https://www.instagram.com/p/AbCdEf123/")?.src).toBe("https://www.instagram.com/p/AbCdEf123/embed");
    expect(embedOf("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(embedOf("javascript:alert(1)")).toBeNull();
  });

  it("iframe の先はすべて許可した先", () => {
    for (const url of ["https://youtu.be/dQw4w9WgXcQ", "https://x.com/a/status/1", "https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC", "https://soundcloud.com/a/b", "https://nico.ms/sm9", "https://vimeo.com/1", "https://www.tiktok.com/@a/video/1", "https://www.instagram.com/reel/AbCdEf123"]) {
      expect(EMBED_ORIGINS).toContain(new URL(embedOf(url)!.src).origin);
    }
  });

  it("本文から 2 件まで、同じものは 1 回、文末の句読点は除く", () => {
    const text = "見て https://youtu.be/dQw4w9WgXcQ。\nこれも https://youtu.be/dQw4w9WgXcQ と https://x.com/a/status/1 と https://vimeo.com/2";
    expect(embedsIn(text).map((e) => e.service)).toEqual(["youtube", "x"]);
  });
});

describe("CSP", () => {
  it("public/_headers の frame-src は、埋め込みの先と同じ", () => {
    const frameSrc = /frame-src ([^;]+);/.exec(headers)?.[1].trim().split(/\s+/) ?? [];
    expect([...frameSrc].sort()).toEqual([...EMBED_ORIGINS].sort());
  });
});
