<script lang="ts">
  import { onMount } from "svelte";
  import { profileProblem, type ProfileField, type ProfileValues } from "../domain/profileEdit";
  import { loadOwnProfile, saveOwnProfile } from "../store/profileEdit";
  import { summary } from "../store/publishSummary";
  import { toast } from "../store/toast.svelte";
  import { TEST_BLOSSOM, uploadFile } from "../store/upload";
  import Icon from "./Icon.svelte";

  /** 自分のプロフィールの編集（Android 版の ProfileEditor）。アイコンと見出し画像は、画像の投稿先へアップロードもできる。 */
  let { close }: { close: () => void } = $props();

  let initial = $state<ProfileValues | null>(null);
  let values = $state<ProfileValues | null>(null);
  let error = $state<string | null>(null);
  let saving = $state(false);
  let uploading = $state<ProfileField | null>(null);

  const FIELDS: { field: ProfileField; label: string; placeholder?: string; long?: boolean }[] = [
    { field: "display_name", label: "表示名" },
    { field: "name", label: "ユーザー名", placeholder: "英数字がおすすめ" },
    { field: "about", label: "自己紹介", long: true },
    { field: "picture", label: "アイコン画像の URL", placeholder: "https://…" },
    { field: "banner", label: "見出し画像の URL", placeholder: "https://…" },
    { field: "website", label: "ウェブサイト", placeholder: "https://…" },
    { field: "nip05", label: "NIP-05", placeholder: "name@example.com" },
    { field: "lud16", label: "ライトニングアドレス（zap の受け取り）", placeholder: "name@example.com" },
  ];

  onMount(() => {
    loadOwnProfile().then(
      (loaded) => {
        initial = { ...loaded };
        values = loaded;
      },
      (e) => (error = e instanceof Error ? e.message : String(e)),
    );
  });

  const problem = $derived(values ? profileProblem(values, TEST_BLOSSOM) : null);
  const changed = $derived(!!values && !!initial && Object.keys(values).some((key) => values![key as ProfileField] !== initial![key as ProfileField]));

  async function upload(field: ProfileField, files: FileList | null) {
    const file = files?.[0];
    if (!file || !values) return;
    uploading = field;
    error = null;
    try {
      if (!file.type.startsWith("image/")) throw new Error("画像を選んでください");
      values[field] = (await uploadFile(file)).url;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      uploading = null;
    }
  }

  async function save() {
    if (!values || !initial || problem) return;
    saving = true;
    error = null;
    try {
      const result = await saveOwnProfile(initial, values);
      toast.show(summary(result));
      if (result.accepted > 0) close();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

<section class="editor" aria-label="プロフィールの編集">
  <h2>プロフィールを編集</h2>
  {#if !values}
    <p class="muted">{error ?? "リレーからプロフィールを読んでいます…"}</p>
  {:else}
    {#each FIELDS as { field, label, placeholder, long } (field)}
      <label>
        <span>{label}</span>
        {#if long}
          <textarea bind:value={values[field]} rows="5" {placeholder}></textarea>
        {:else}
          <span class="line">
            <input bind:value={values[field]} {placeholder} spellcheck="false" />
            {#if field === "picture" || field === "banner"}
              <input type="file" accept="image/*" hidden id="upload-{field}" onchange={(event) => { void upload(field, event.currentTarget.files); event.currentTarget.value = ""; }} />
              <label class="upload" for="upload-{field}" title="画像を選んでアップロード" aria-disabled={uploading !== null}>
                <Icon name="addPhoto" size={18} />{uploading === field ? "送っています…" : "画像を選ぶ"}
              </label>
            {/if}
          </span>
        {/if}
      </label>
    {/each}
    <p class="muted">空にした項目は消します。ここにない項目（ほかのアプリで付けたもの）はそのまま残します。</p>
    {#if problem}<p class="error">{problem}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" class="text" onclick={close}>やめる</button>
      <button type="button" class="ok" disabled={saving || !!problem || !changed || uploading !== null} onclick={save}>{saving ? "送っています…" : "保存して公開"}</button>
    </div>
  {/if}
</section>

<style>
  .editor {
    display: grid;
    gap: 10px;
    padding: 12px 16px 16px;
    border-bottom: 1px solid var(--outline-variant);
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 0.9em;
  }
  label > span:first-child {
    color: var(--muted);
  }
  .line {
    display: flex;
    gap: 6px;
  }
  input:not([type]),
  textarea {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 7px 10px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    background: var(--background);
    color: var(--text);
    resize: vertical;
  }
  .upload {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    padding: 0 10px;
    font-size: 0.85em;
    color: var(--primary);
    border: 1px solid var(--outline);
    border-radius: 8px;
    cursor: pointer;
  }
  .upload[aria-disabled="true"] {
    opacity: 0.5;
    pointer-events: none;
  }
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: 0.85em;
  }
  .error {
    margin: 0;
    color: #d33;
    font-size: 0.9em;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    font: inherit;
    border-radius: 999px;
    padding: 6px 18px;
    cursor: pointer;
  }
  .text {
    color: var(--primary);
    background: none;
    border: none;
  }
  .ok {
    color: var(--on-primary);
    background: var(--primary);
    border: none;
    font-weight: 600;
  }
  .ok:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
