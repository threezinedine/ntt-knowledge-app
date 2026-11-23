import { useI18n } from './context';

export function LanguagePicker() {
  const { t, locale, locales, setLocale } = useI18n();
  if (locales.length < 2) return null;
  return (
    <select
      className="language-picker"
      aria-label={t('app.language')}
      value={locale}
      onChange={(e) => {
        setLocale(e.target.value);
      }}
    >
      {locales.map((l) => (
        <option key={l.code} value={l.code} lang={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
