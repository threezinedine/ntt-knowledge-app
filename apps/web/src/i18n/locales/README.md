# Translations

Each `*.json` file here is one UI language. The file name is the language tag
(`vi.json`, `fr.json`, `pt-BR.json`). The app picks it up automatically: it shows
in the language picker, and browsers set to that language start in it.

## Add a language

1. Copy `en.json` to `<tag>.json`, for example `fr.json`.
2. Set `"meta.languageName"` to the language's own name, for example `"Français"`.
3. Translate the values. Leave the keys as they are.
4. Run `npm run check`. It fails if a key is misspelled or a `{placeholder}` was
   dropped or renamed.

You can leave a key out or empty. That text then shows in English, so a
partial translation is fine.

## Rules for values

- `{name}`-style placeholders are filled in by the app. Keep every placeholder
  that the English text has, but feel free to move it within the sentence.
- `⤒ + ✎ →` are the symbols on the buttons. Keep them.
- `error.code.*` / `error.reason.*` are the messages shown when the server
  refuses a request.

## For developers

`en.json` is the source of truth: it defines the `MessageKey` type, so
`t('typo')` is a compile error. A new UI string goes into `en.json` first,
then every bundled locale (`locales.test.ts` requires `vi.json` to be
complete).

Not translated: the app name, the install manifest (`vite.config.ts`) and the
`<title>` in `index.html`. These are fixed when the app is built.
