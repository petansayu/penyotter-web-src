import type { EventTemplate } from "nostr-tools";
import type { Event } from "../nostr/events";
import { nextCreatedAt } from "./lists";

/**
 * プロフィール（kind 0）の書き換え（Android 版の ProfileEditService）。いちばん新しい版の JSON を元に、画面で
 * 変えた項目だけを書き換え、知らない項目は残す。空にした項目は消す。
 */

export const PROFILE_FIELDS = ["name", "display_name", "about", "picture", "banner", "website", "nip05", "lud16"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ProfileValues = Record<ProfileField, string>;

const LIMITS: Record<ProfileField, number> = { name: 100, display_name: 100, about: 4000, picture: 2000, banner: 2000, website: 2000, nip05: 200, lud16: 200 };
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
