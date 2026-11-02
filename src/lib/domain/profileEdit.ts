import type { EventTemplate } from "nostr-tools";
import type { Event } from "../nostr/events";
import { nextCreatedAt } from "./lists";

/**
 * プロフィール（kind 0）の書き換え（Android 版の ProfileEditService）。いちばん新しい版の JSON を元に、画面で
 * 変えた項目だけを書き換え、知らない項目は残す。空にした項目は消す。
 */

export const PROFILE_FIELDS = ["name", "display_name", "about", "picture", "banner", "website", "nip05", "lud16", "bot", "birthday"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ProfileValues = Record<ProfileField, string>;

const LIMITS: Record<ProfileField, number> = { name: 100, display_name: 100, about: 4000, picture: 2000, banner: 2000, website: 2000, nip05: 200, lud16: 200, bot: 5, birthday: 20 };

/**
 * 誕生日（NIP-24 の birthday、年・月・日はどれも省略できる）を「年/月/日」の文字にする・戻す（Android 版と同じ形。
 * 例: 2000/4/12、/4/12、2000//）。
 */
export function birthdayText(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const raw = value as Record<string, unknown>;
  const part = (key: string) => (typeof raw[key] === "number" && Number.isInteger(raw[key]) ? String(raw[key]) : "");
  const text = [part("year"), part("month"), part("day")].join("/");
  return text === "//" ? "" : text;
}

export function parseBirthday(text: string): { year?: number; month?: number; day?: number } {
  const match = /^(\d{1,4})?\/(\d{1,2})?\/(\d{1,2})?$/.exec(text.trim());
  if (!match) throw new Error("誕生日は 年/月/日 の形で入れてください（年・月・日は省略できます。例: /4/12）");
  const [year, month, day] = match.slice(1).map((v) => (v ? Number(v) : undefined));
  if (year === undefined && month === undefined && day === undefined) throw new Error("誕生日を入れてください");
  if (year !== undefined && (year < 1 || year > 9999)) throw new Error("誕生日の年を確かめてください");
  if (month !== undefined && (month < 1 || month > 12)) throw new Error("誕生日の月を確かめてください");
  if (day !== undefined && (day < 1 || day > 31)) throw new Error("誕生日の日を確かめてください");
  if (month !== undefined && day !== undefined) {
    const date = new Date(Date.UTC(year ?? 2000, month - 1, day));
    if (date.getUTCMonth() !== month - 1) throw new Error("誕生日の日を確かめてください");
  }
  return { ...(year !== undefined ? { year } : {}), ...(month !== undefined ? { month } : {}), ...(day !== undefined ? { day } : {}) };
}
const URL_FIELDS = new Set<ProfileField>(["picture", "banner", "website"]);

/** 元の版の JSON（読めなければ空）。 */
export function profileObject(base: Event | undefined): Record<string, unknown> {
  if (!base) return {};
  try {
    const raw = JSON.parse(base.content) as unknown;
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 画面に出す値（元の版から）。display_name がなければ古い displayName。 */
export function profileValues(base: Event | undefined): ProfileValues {
  const raw = profileObject(base);
  const pick = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : "");
  const values = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, pick(field)])) as ProfileValues;
  if (!values.display_name) values.display_name = pick("displayName");
  values.bot = raw.bot === true ? "true" : "false";
  values.birthday = birthdayText(raw.birthday);
  return values;
}

/** 入れた値を確かめる。だめなら日本語の理由。test は手元のテスト用の投稿先（http）を通すときのオリジン。 */
export function profileProblem(values: ProfileValues, test: string | null = null): string | null {
  for (const field of PROFILE_FIELDS) {
    const value = values[field].trim();
    if (value.length > LIMITS[field]) return `${field} は ${LIMITS[field]} 文字までです`;
    if (value && URL_FIELDS.has(field) && !/^https:\/\/[^\s]+$/i.test(value) && !(test && value.startsWith(`${test}/`))) return `${field} は https:// で始まる URL にしてください`;
  }
  if (values.nip05.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$|^[^\s@]+\.[^\s@]+$/.test(values.nip05.trim())) return "NIP-05 は name@example.com の形にしてください";
  if (values.lud16.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.lud16.trim())) return "ライトニングアドレスは name@example.com の形にしてください";
  if (values.birthday.trim()) {
    try {
      parseBirthday(values.birthday);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  return null;
}

/** 次の版。変えた項目だけを書き換え、空にした項目は消す。古い displayName は display_name にそろえる。 */
export function buildProfile(base: Event | undefined, values: ProfileValues, now: number, test: string | null = null): EventTemplate {
  const problem = profileProblem(values, test);
  if (problem) throw new Error(problem);
  const before = profileValues(base);
  const next: Record<string, unknown> = { ...profileObject(base) };
  for (const field of PROFILE_FIELDS) {
    const value = values[field].trim();
    if (field === "bot" || field === "birthday") {
      // 真偽値とオブジェクト。変えたときだけ書き換える
      if (value === before[field].trim()) continue;
      if (field === "bot") next.bot = value === "true";
      else if (value) next.birthday = parseBirthday(value);
      else delete next.birthday;
      continue;
    }
    if (value === before[field].trim() && field in next) continue;
    if (value) next[field] = value;
    else delete next[field];
  }
  if ("displayName" in next) {
    if (next.display_name) next.displayName = next.display_name;
    else delete next.displayName;
  }
  return { kind: 0, created_at: nextCreatedAt(now, base), tags: base?.tags.map((tag) => [...tag]) ?? [], content: JSON.stringify(next) };
}
