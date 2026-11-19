import { describe, expect, it } from "vitest";
import { appendShared, sharedText } from "./share";

describe("ほかのアプリからの共有の受け取り", () => {
  const params = (fields: Record<string, string>) => new URLSearchParams(fields);
  it("文とリンクを改行でつなぐ。リンクが文に入っていれば重ねない。題名は文もリンクもないときだけ", () => {
    expect(sharedText(params({ text: "いい記事", url: "https://x.test/a" }))).toBe("いい記事\nhttps://x.test/a");
    expect(sharedText(params({ text: "いい記事 https://x.test/a", url: "https://x.test/a" }))).toBe("いい記事 https://x.test/a");
    expect(sharedText(params({ title: "題名", url: "https://x.test/a" }))).toBe("https://x.test/a");
    expect(sharedText(params({ title: "題名" }))).toBe("題名");
    expect(sharedText(params({ text: "  " }))).toBeNull();
  });
  it("いまの本文の後ろに足す", () => {
    expect(appendShared("", "共有")).toBe("共有");
    expect(appendShared("書きかけ\n\n", "共有")).toBe("書きかけ\n共有");
  });
});
