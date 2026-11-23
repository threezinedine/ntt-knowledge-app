import { useAuthStatus, useSignOut } from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { useCommandTooltip } from '../../commands/useCommandTooltip';
import { SignOutIcon } from '../../components/icons';
import { useI18n } from '../../i18n/context';

/** Activity bar, bottom: sign out (only when sign-in is on and you're in). */
export function SignOutButton() {
  const status = useAuthStatus();
  const signOut = useSignOut();
  const { t } = useI18n();
  const tip = useCommandTooltip('km.auth.signOut', { always: true });
  const signedIn = status.data?.enabled === true && status.data.signedIn;
  useCommandHandler(
    'km.auth.signOut',
    () => {
      signOut.mutate();
    },
    signedIn,
  );
  if (!signedIn) return null;
  return (
    <button
      type="button"
      className="activity-button"
      aria-label={t('cmd.signOut')}
      {...tip}
      disabled={signOut.isPending}
      onClick={() => {
        signOut.mutate();
      }}
    >
      <SignOutIcon size={22} />
    </button>
  );
}
