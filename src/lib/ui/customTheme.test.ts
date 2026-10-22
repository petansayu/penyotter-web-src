import { describe, expect, it } from "vitest";
import { DEFAULT_DARK, DEFAULT_LIGHT, nextName, resolvePalette, themeOf } from "./customTheme";

describe("じぶんで作るカラーテーマ", () => {
  it("自動の色を背景とメインの色から決める", () => {
    const light = resolvePalette(DEFAULT_LIGHT, false);
    expect(light.text).toBe("#1E2328");
    expect(light.accent).toBe(DEFAULT_LIGHT.primary);
    expect(light.buttonText).toBe("#FFFFFF");
    expect(resolvePalette(DEFAULT_DARK, true).text).toBe("#E8EBEE");
    expect(resolvePalette({ ...DEFAULT_LIGHT, text: "#123456" }, false).text).toBe("#123456");
  });
  it("ほかのテーマと同じ形にし、名前は重ならないように", () => {
    const theme = themeOf({ id: "x", name: "わたし", light: DEFAULT_LIGHT, dark: DEFAULT_DARK });
    expect(theme).toMatchObject({ id: "custom:x", label: "わたし" });
    expect(theme.exact?.dark.background).toBe("#14181C");
    expect(nextName([{ id: "1", name: "じぶんのテーマ", light: DEFAULT_LIGHT, dark: DEFAULT_DARK }])).toBe("じぶんのテーマ 2");
  });
});
