import { useEffect, useId, useRef } from 'react';
import { CloseIcon } from '../../components/icons';
import { useI18n } from '../../i18n/context';
import {
  resetGraphSettings,
  setGraphSettings,
  SETTING_GROUPS,
  useGraphSettings,
  type SettingGroup,
} from './graphSettings';

/** Shows 0.45 as "0.45" and 12 as "12" (steps below 1 get two decimals at most). */
function formatValue(value: number, step: number): string {
  return step < 1 ? String(Math.round(value * 100) / 100) : String(Math.round(value));
}

/** Sliders and switches for the given groups; every change applies and saves at once. */
export function GraphSettingsForm({ groups }: { groups: readonly SettingGroup[] }) {
  const { t } = useI18n();
  const settings = useGraphSettings();
  const idPrefix = useId();
  return (
    <div className="graph-settings-form">
      {groups.map((group) => (
        <section key={group.id} className="graph-settings-group" aria-label={t(group.title)}>
          <h3>{t(group.title)}</h3>
          {group.fields.map((field) =>
            field.kind === 'boolean' ? (
              <label key={field.key} className="graph-settings-switch">
                <input
                  type="checkbox"
                  checked={settings[field.key]}
                  onChange={(e) => {
                    setGraphSettings({ [field.key]: e.target.checked });
                  }}
                />
                {t(field.label)}
              </label>
            ) : (
              // Not one <label> around it all: <output> is labelable too, and would
              // take the name instead of the slider.
              <div key={field.key} className="graph-settings-slider">
                <span className="graph-settings-label">
                  <label htmlFor={`${idPrefix}-${field.key}`}>{t(field.label)}</label>
                  <output htmlFor={`${idPrefix}-${field.key}`}>
                    {formatValue(settings[field.key], field.step)}
                  </output>
                </span>
                <input
                  id={`${idPrefix}-${field.key}`}
                  type="range"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={settings[field.key]}
                  onChange={(e) => {
                    setGraphSettings({ [field.key]: Number(e.target.value) });
                  }}
                />
              </div>
            ),
          )}
          <button
            type="button"
            className="graph-settings-reset"
            onClick={() => {
              resetGraphSettings(group.id);
            }}
          >
            {t('graphSettings.resetGroup')}
          </button>
        </section>
      ))}
    </div>
  );
}

/** Beside the 2D graph (desktop): every setting, dragging included. */
export function GraphSettingsPanel({
  id,
  focusOnMount,
  onClose,
}: {
  id: string;
  /** Opened by the user just now (not restored open on load). */
  focusOnMount: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) closeRef.current?.focus();
  }, [focusOnMount]);
  return (
    <section
      id={id}
      className="graph-settings"
      aria-label={t('graphSettings.title')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <h2>{t('graphSettings.title')}</h2>
        <button
          ref={closeRef}
          type="button"
          className="graph-settings-close"
          aria-label={t('graphSettings.close')}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <GraphSettingsForm groups={SETTING_GROUPS} />
    </section>
  );
}

/** Its own tab in the phone app: only what changes the look (nothing is dragged there). */
export function GraphSettingsPage() {
  const { t } = useI18n();
  return (
    <div className="graph-settings-page">
      <h1>{t('graphSettings.title')}</h1>
      <GraphSettingsForm groups={SETTING_GROUPS.filter((g) => g.display)} />
    </div>
  );
}
