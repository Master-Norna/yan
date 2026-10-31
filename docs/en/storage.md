# Storage and backup

[← Docs](README.md) · [中文](../storage.md)

Chats, Files, attachments and settings all live in one storage folder (`~/.yan/` by default). The folder names are in Chinese:

- `对话/` (chats): one JSON file per chat; copying is backing up. For finished long replies, the reasoning and helper runs are stored separately under `对话/行迹/` and the chat file keeps only a reference; they are loaded back when you open the chat. Stored parts no chat refers to are cleared after a day.
- `卷宗/` (Files): outputs and files you've saved.
- `附件/` (attachments): originals of chat attachments, each an original plus a `.json` metadata file of the same name.
- `技能/` (skills): the skills Yan recognizes (see [Skills](skills.md)).
- `游目/` (browser panel): the browser panel's own browser — dependencies, sign-ins and bookmarks, downloads, the bundled engine (see [Browser panel](stage.md)).
- `环境/` (environment): the Python and toolchains prepared for the model (see [Sandbox environment](env.md)).
- `检查点/` (checkpoints): the folder as it was before each reply first changed files (see [Agent · Checkpoints](work.md#checkpoints)).
- `配置.json` (settings): settings, model configuration (including API keys), memory and drafts.

All browsers share this one copy instead of each keeping its own. Two pages open at once, each editing, don't overwrite each other: before writing, Yan compares with the copy on disk, and if it changed elsewhere, merges three ways against the last synced copy — your changes win for what you changed, the other side's for what you didn't. A chat deleted elsewhere is deleted here too, never pushed back to life. The browser's copy is only a cache, plus a holding area while the bridge is disconnected; once reconnected, it syncs with the storage folder.

**Settings → General** has a single **Storage location**. Moving it copies everything to the new place (if Yan's data is already there, it is used as is; `环境/` isn't copied and is set up again in the new place), and the old place is left untouched. It won't move while any chat is answering (on any page, background subagents included); wait for the answer to finish — otherwise the old place would still be written while copying, and the moved copy would miss that part.

If an attachment original can't be written to disk, it waits in the browser's IndexedDB and is pushed into `附件/` once reconnected. Nothing goes through any cloud.

## Backup

- Backup export and import: on export you can tick **Include attachments**. Import merges (chats / models / Files items that already exist are skipped by id, and non-conflicting drafts are merged). Backups never include API keys.
