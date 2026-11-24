import { hubIsNewer, type HubVersion, type SyncStatus } from '@km/core';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { ApiError } from '../../api/client';
import { useIsMutating } from '@tanstack/react-query';
import {
  keys,
  useSyncConnect,
  useSyncDisconnect,
  useSyncPull,
  useSyncPush,
  useSyncStatus,
} from '../../api/queries';
import { suspendKeybindings } from '../../commands/dispatch';
import { showToast } from '../../components/toast';
import { useI18n } from '../../i18n/context';
import { isNativeApp } from '../readOnly';
import { closeSyncDialog, type SyncAction } from './syncStore';

const reasonOf = (err: unknown) => (err instanceof ApiError ? err.body?.error.reason : undefined);

export function useWhen(): (ms: number) => string {
  const { locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (ms) => fmt.format(ms);
}

/**
 * Connect to a hub, then push or pull by hand. Overwriting the other side
 * always asks first: pushing over a hub version this device hasn't pulled,
 * or pulling over changes the hub doesn't have.
 */
export function SyncDialog({
  action,
  pullOnly,
}: {
  action: SyncAction | null;
  /** The phone app: it reads a copy, so there is nothing to push. */
  pullOnly: boolean;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const status = useSyncStatus();
  // Not closed mid-push or mid-pull: its outcome (a confirm, an error) shows here.
  const busy = useIsMutating({ mutationKey: keys.sync }) > 0;
  useEffect(() => {
    ref.current?.showModal();
    return suspendKeybindings();
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog sync-dialog"
      aria-labelledby="sync-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) closeSyncDialog();
      }}
    >
      <h2 id="sync-dialog-title">{t('sync.title')}</h2>
      {status.data === undefined ? (
        <p className="muted">{t('common.loading')}</p>
      ) : status.data.connected ? (
        <Connected status={status.data} initialAction={action} pullOnly={pullOnly} />
      ) : (
        <ConnectForm suggestedName={status.data.suggestedName} />
      )}
    </dialog>
  );
}

function ConnectForm({ suggestedName }: { suggestedName: string }) {
  const { t, errorText } = useI18n();
  const connect = useSyncConnect();
  // The web app comes from the hub; the phone app ships its own files.
  const [hubUrl, setHubUrl] = useState(() => (isNativeApp() ? '' : window.location.origin));
  const [code, setCode] = useState('');
  const [name, setName] = useState(suggestedName);

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (connect.isPending) return;
    connect.mutate(
      { hubUrl, code, deviceName: name },
      {
        onError: () => {
          setCode('');
        },
      },
    );
  };

  return (
    <form className="sync-form" onSubmit={submit}>
      <p className="muted">{t('sync.connectIntro')}</p>
      <label htmlFor="km-sync-url">{t('sync.hubUrl')}</label>
      <input
        id="km-sync-url"
        autoFocus
        inputMode="url"
        placeholder="http://192.168.1.20:4317"
        value={hubUrl}
        onChange={(e) => {
          setHubUrl(e.target.value);
        }}
      />
      <label htmlFor="km-sync-code">{t('sync.code')}</label>
      <input
        id="km-sync-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        aria-describedby="km-sync-code-hint"
        value={code}
        onChange={(e) => {
          setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
        }}
      />
      <p id="km-sync-code-hint" className="muted small">
        {t('sync.codeHint')}
      </p>
      <label htmlFor="km-sync-name">{t('sync.deviceName')}</label>
      <input
        id="km-sync-name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      {connect.error && (
        <p className="error" role="alert">
          {errorText(connect.error)}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={closeSyncDialog}>
          {t('sync.close')}
        </button>
        <button
          type="submit"
          disabled={connect.isPending || hubUrl.trim() === '' || name.trim() === ''}
        >
          {connect.isPending ? t('sync.connecting') : t('sync.connect')}
        </button>
      </div>
    </form>
  );
}

type Confirm = { kind: 'push'; hub: HubVersion } | { kind: 'pull'; hub: HubVersion | null };

function Connected({
  status,
  initialAction,
  pullOnly,
}: {
  status: Extract<SyncStatus, { connected: true }>;
  initialAction: SyncAction | null;
  pullOnly: boolean;
}) {
  const { t, errorText } = useI18n();
  const when = useWhen();
  const push = useSyncPush();
  const pull = useSyncPull();
  const disconnect = useSyncDisconnect();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<unknown>(null);
  const busy = push.isPending || pull.isPending || disconnect.isPending;

  const doPush = (force: boolean) => {
    setError(null);
    // Known to overwrite: ask before even trying.
    if (!force && hubIsNewer(status) && status.hub) {
      setConfirm({ kind: 'push', hub: status.hub });
      return;
    }
    push.mutate(force, {
      onSuccess: (s) => {
        setConfirm(null);
        if (s.connected && s.synced) showToast(t('sync.pushed', { version: s.synced.version }));
      },
      onError: (err) => {
        const details = err instanceof ApiError ? err.body?.error.details : undefined;
        const head = (details as { head?: HubVersion } | undefined)?.head;
        if (reasonOf(err) === 'SYNC_BEHIND' && head) setConfirm({ kind: 'push', hub: head });
        else setError(err);
      },
    });
  };

  const doPull = (force: boolean) => {
    setError(null);
    if (!force && status.localChanged) {
      setConfirm({ kind: 'pull', hub: status.hub });
      return;
    }
    // On success the page reloads (useSyncPull).
    pull.mutate(force, {
      onError: (err) => {
        if (reasonOf(err) === 'SYNC_LOCAL_CHANGES') setConfirm({ kind: 'pull', hub: status.hub });
        else setError(err);
      },
    });
  };

  const started = useRef(false);
  useEffect(() => {
    if (initialAction === null) return;
    // Once, when opened from the Push / Pull command (after the first paint).
    const timer = setTimeout(() => {
      if (started.current) return;
      started.current = true;
      if (initialAction === 'push') doPush(false);
      else doPull(false);
    });
    return () => {
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (confirm) {
    const { hub } = confirm;
    return (
      <div className="sync-confirm" role="group" aria-labelledby="sync-confirm-title">
        <h3 id="sync-confirm-title">
          {confirm.kind === 'push' ? t('sync.confirmPushTitle') : t('sync.confirmPullTitle')}
        </h3>
        <p>
          {confirm.kind === 'push'
            ? t('sync.confirmPush', {
                version: confirm.hub.version,
                device: confirm.hub.deviceName,
                when: when(confirm.hub.createdAt),
              })
            : t('sync.confirmPull', { version: hub?.version ?? '?' })}
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            autoFocus
            onClick={() => {
              setConfirm(null);
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (confirm.kind === 'push') doPush(true);
              else doPull(true);
            }}
          >
            {confirm.kind === 'push' ? t('sync.pushAnyway') : t('sync.pullAnyway')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sync-status">
      <dl>
        <dt>{t('sync.hub')}</dt>
        <dd>
          <code>{status.hubUrl}</code>
          <br />
          {status.problem !== null ? (
            <span className="error">{t(`error.reason.${status.problem}`)}</span>
          ) : status.hub ? (
            t('sync.hubNewest', {
              version: status.hub.version,
              device: status.hub.deviceName,
              when: when(status.hub.createdAt),
            })
          ) : (
            t('sync.hubEmpty')
          )}
        </dd>
        <dt>{t('sync.thisDevice', { name: status.deviceName })}</dt>
        <dd>
          {status.synced
            ? t('sync.synced', {
                version: status.synced.version,
                when: when(status.synced.createdAt),
              })
            : t('sync.neverSynced')}
          {!pullOnly && (
            <>
              <br />
              {status.localChanged ? t('sync.localChanged') : t('sync.localClean')}
            </>
          )}
        </dd>
      </dl>
      {error !== null && (
        <p className="error" role="alert">
          {errorText(error)}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="sync-disconnect"
          disabled={busy}
          onClick={() => {
            disconnect.mutate();
          }}
        >
          {t('sync.disconnect')}
        </button>
        <span className="spacer" />
        <button type="button" disabled={busy} onClick={closeSyncDialog}>
          {t('sync.close')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            doPull(false);
          }}
        >
          {pull.isPending ? t('sync.pulling') : t('sync.pull')}
        </button>
        {!pullOnly && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              doPush(false);
            }}
          >
            {push.isPending ? t('sync.pushing') : t('sync.push')}
          </button>
        )}
      </div>
    </div>
  );
}
