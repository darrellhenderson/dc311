import { useEffect, useRef } from 'react';
import { trackEvent } from '../lib/analytics';

/** Fires overview_article_view once when the section is half visible. */
export function useTrackArticleView(articleId: string) {
  const ref = useRef<HTMLElement>(null);
  const tracked = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || tracked.current || !articleId) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5 || tracked.current) {
          return;
        }
        tracked.current = true;
        trackEvent('overview_article_view', { article: articleId });
        observer.disconnect();
      },
      { threshold: 0.5 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [articleId]);

  return ref;
}
