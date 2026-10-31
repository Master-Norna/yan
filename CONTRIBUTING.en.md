# Contributing to Yan

[中文](CONTRIBUTING.md) · **English**

Thanks for helping build Yan. Please take a few minutes to read this page — PRs are reviewed against the trade-offs below.

## Workflow

1. Small fixes (typos, obvious bugs) can go straight to a PR. For new features or larger changes, open an issue first describing what and why, so we can agree on direction before you write the code.
2. Fork the repo, branch off `main`, and open a PR against `main`.
3. The CI job "单测 · 类型 · 格式" (unit · types · format) must pass. The end-to-end and macOS test jobs are informational for now.
4. A maintainer reviews before merging. PRs are squash-merged, so each PR lands as one commit on `main`.

## Running locally

All you need is Node 18 or later — there is no `npm install` step.

```bash
npm start          # start the local bridge and open the browser (http://127.0.0.1:8787)
npm run unit       # unit tests, a few seconds
npm run check      # type check (tsc --checkJs, installed into an untracked node_modules)
npm run format     # format with Prettier; run it before opening a PR
npm test           # unit + end-to-end; e2e needs Edge or Chrome and is written for Windows
```

There is no build step: the bridge concatenates `prompts/`, `src/` and `styles/` in path order on each request, so a refresh picks up your edit. For the directory layout and concatenation rules, see [Code structure and development](docs/en/development.md).

## Project trade-offs

- **Keep it light; no wasted features.** Yan is an agent shell for a handful of people who build on it, not a mass-market product. Don't rebuild what the browser or OS already provides (split screen, windows, tabs). No mobile or touch layouts.
- **One way to do each thing.** If a more general mechanism covers it, don't add a parallel path; once the general one exists, remove the old path.
- **Adjust the structure before adding modules.** For a new capability, first look for an existing constraint that, relaxed or reshaped, makes it fall out naturally. Add a new parallel module only when that fails.
- **No defensive restrictions.** Don't add another confirmation, toggle or cap "in case something goes wrong": users know what they're asking for, and the sandbox and reviewer are the safety net.
- **No special mechanisms for one model's quirks.** A model that degenerates or ignores formats is the model's problem; if a fallback is needed, find a design that holds for every model.
- **Zero dependencies, no build.** Don't add npm runtime dependencies or a bundler/transpiler. If a third-party library is truly needed, it goes in `vendor/` — discuss it in an issue first.
- **Windows first.** macOS only needs to work: anything that touches the OS (opening URLs or files, killing process trees, finding a browser) goes through `server/platform.js`, not ad-hoc code. Linux is out of scope.
- **New features start from a registry.** Tools, model providers, settings tabs, file kinds, embeds… every extension point in Yan is a table, and adding something means adding one entry. If no table fits, create the table first, then add the first entry. See [Code structure and development](docs/en/development.md) for where each table lives.
- **One writer per conversation at a time.** When several pages are open, leases decide which one writes; the others only watch. Multi-page write issues are solved within this rule, not by merging after the fact. State lives in the page; the bridge only arbitrates and relays, it doesn't host conversations.
- **Prompts say only what's necessary.** The test is "would the model fail without this sentence?" No personality lectures, no reminders for things the structure already handles. Read [`prompts/README.md`](prompts/README.md) before editing `prompts/`.
- **UI text in two languages.** User-facing strings are written as `t("中文原文")` with the Chinese as the key; add the English to `i18n/en.js` (`test/i18n.mjs` lists missing ones). Prompts for the model are not translated.
- **UI copy reads like a product, not a tutorial.** The Chinese mixes classical and plain register. Buttons use full words; no "click here to…" hints. Explanations of how things work go in Settings → Docs. One name per thing — where a literary name exists, use it.
- **Docs in two languages.** Update `docs/` and `docs/en/`, `README.md` and `README.en.md` together.
- **Keep the visual language consistent.** Yan has an ink-on-paper style; please attach before/after screenshots to PRs that change the UI. Each area gets exactly one signature element of its own (the ensō in Listen, the single vermilion stroke in Browser); everything else uses the shared vocabulary — don't spread one motif across the whole area.

## Commit messages

Chinese or English are both fine. One change per commit, prefixed with its kind (e.g. `fix:`, `docs:`, `test:` or 「修复：」「文档：」), saying what changed and why.

## License

Yan is released under Apache-2.0. Under section 5 of the license, your contributions are licensed under Apache-2.0 as well; no separate agreement is needed.
