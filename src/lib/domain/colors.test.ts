import { describe, expect, it } from "vitest";
import { colorOf } from "./colors";
import { segments } from "./content";

describe("カラーコード", () => {
  it("6・8 桁はいつも色", () => {
    expect(colorOf("ff8800", [])?.css).toBe("#ff8800");
    expect(colorOf("FF880080", [])?.alpha).toBeCloseTo(128 / 255);
  });

  it("3・4 桁は、ハッシュタグとして付いているときと年のときを除いて色", () => {
    expect(colorOf("fff", [])?.css).toBe("#ffffff");
    expect(colorOf("cafe", [["t", "cafe"]])).toBeNull();
    expect(colorOf("2026", [])).toBeNull();
    expect(colorOf("12345", [])).toBeNull();
  });

  it("本文の中で、色とハッシュタグを分ける", () => {
    const parts = segments("色は#ff8800です #cafe #ぺにょったー #ff8800g", new Map(), [["t", "cafe"]]);
    expect(parts).toEqual([
      { type: "text", text: "色は" },
      { type: "color", code: "#ff8800", css: "#ff8800", alpha: 1 },
      { type: "text", text: "です " },
      { type: "hashtag", tag: "cafe" },
      { type: "text", text: " " },
      { type: "hashtag", tag: "ぺにょったー" },
      { type: "text", text: " " },
      { type: "hashtag", tag: "ff8800g" },
    ]);
  });
});
