import type { ReviewCard, ReviewResult } from '@km/core';
import { Link } from 'react-router';
import { useAnswerReview, useReview } from '../../api/queries';
import { useI18n } from '../../i18n/context';
import { useReadOnly } from '../readOnly';

/** What a card is about, for its buttons' names ("Done: Pipelines"). */
function cardName(card: ReviewCard): string {
  return card.kind === 'dig' ? card.node.title : `${card.node.title} ↔ ${card.other.title}`;
}

/** Today's due cards, for the activity bar's badge (0 while loading, or read-only). */
export function useReviewCount(): number {
  const readOnly = useReadOnly();
  const review = useReview(!readOnly);
  return readOnly ? 0 : (review.data?.cards.length ?? 0);
}

/**
 * Spaced repetition, on its own tab (like Tags): today's cards. A shallow
 * node asks to be dug deeper (another 5 Whys round); a pair of well-dug,
 * unlinked nodes asks whether they're related. Done / Again move the card
 * along its schedule. Editable devices only: answering writes.
 */
export function ReviewPage() {
  const review = useReview(true);
  const answer = useAnswerReview();
  const { t, errorText } = useI18n();
  const cards = review.data?.cards ?? [];
  const more = review.data ? review.data.more.dig + review.data.more.link : 0;
  const answered = review.data ? review.data.answeredToday.dig + review.data.answeredToday.link : 0;
  const send = (card: ReviewCard, result: ReviewResult) => {
    answer.mutate({
      kind: card.kind,
      nodeId: card.node.id,
      otherNodeId: card.kind === 'link' ? card.other.id : null,
      result,
    });
  };

  return (
    <div className="review-page">
      <h2>{t('review.heading')}</h2>
      <p className="muted">{t('review.help')}</p>
      {review.isError && <p className="error">{errorText(review.error)}</p>}
      {answer.isError && <p className="error">{errorText(answer.error)}</p>}
      {review.data && cards.length === 0 && (
        <p className="muted">{t(answered > 0 ? 'review.doneToday' : 'review.empty')}</p>
      )}
      <ul className="review-list" aria-label={t('review.heading')}>
        {cards.map((card) => {
          const name = cardName(card);
          const key =
            card.kind === 'dig' ? `dig-${card.node.id}` : `link-${card.node.id}-${card.other.id}`;
          return (
            <li key={key} className="review-card" aria-label={name}>
              {card.kind === 'dig' ? (
                <>
                  <span className="review-kind">{t('review.dig')}</span>
                  <Link className="review-title" to={`/nodes/${card.node.id}`}>
                    {card.node.title}
                  </Link>
                  <span className="muted review-detail">
                    {t('review.digDetail', {
                      whys: card.node.answeredWhys,
                      depth: card.node.maxDepth,
                    })}
                  </span>
                </>
              ) : (
                <>
                  <span className="review-kind">{t('review.link')}</span>
                  <span className="review-title">
                    <Link to={`/nodes/${card.node.id}`}>{card.node.title}</Link>
                    <span aria-hidden="true"> ↔ </span>
                    <Link to={`/nodes/${card.other.id}`}>{card.other.title}</Link>
                  </span>
                  <span className="muted review-detail">{t('review.linkDetail')}</span>
                </>
              )}
              <span className="review-actions">
                <button
                  type="button"
                  aria-label={t('review.doneFor', { name })}
                  disabled={answer.isPending}
                  onClick={() => {
                    send(card, 'done');
                  }}
                >
                  {t('review.done')}
                </button>
                <button
                  type="button"
                  className="subtle"
                  aria-label={t('review.againFor', { name })}
                  disabled={answer.isPending}
                  onClick={() => {
                    send(card, 'again');
                  }}
                >
                  {t('review.again')}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {more > 0 && <p className="muted">{t('review.more', { count: more })}</p>}
    </div>
  );
}
