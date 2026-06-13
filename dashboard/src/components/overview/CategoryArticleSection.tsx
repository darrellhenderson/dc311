import { ReactNode } from 'react';
import { ArticlePart, CategoryArticle } from '../../lib/overviewAnalytics';
import ChartPanel from '../shared/ChartPanel';
import PlotlyChart from '../shared/PlotlyChart';

interface CategoryArticleSectionProps {
  article: CategoryArticle;
  chartData: Record<string, unknown>[];
  chartLayout: Record<string, unknown>;
  chartRemountKey: string;
  onNavigate: (tab: 'sla' | 'explorer') => void;
  embedded?: boolean;
}

function renderPart(part: ArticlePart, onNavigate: CategoryArticleSectionProps['onNavigate']): ReactNode {
  if (part.kind === 'text') return part.text;
  return (
    <button
      key={part.text}
      type="button"
      className="article-link"
      onClick={() => onNavigate(part.tab)}
    >
      {part.text}
    </button>
  );
}

function ArticleParagraph({
  parts,
  onNavigate,
}: {
  parts: ArticlePart[];
  onNavigate: CategoryArticleSectionProps['onNavigate'];
}) {
  return (
    <p>
      {parts.map((part, i) => (
        <span key={i}>{renderPart(part, onNavigate)}</span>
      ))}
    </p>
  );
}

export default function CategoryArticleSection({
  article,
  chartData,
  chartLayout,
  chartRemountKey,
  onNavigate,
  embedded = false,
}: CategoryArticleSectionProps) {
  return (
    <article className={`article-prose w-full ${embedded ? 'px-0 py-4 sm:py-5' : 'border-t border-border pt-4 mt-4'}`}>
      <header>
        <h2 className="article-headline">{article.headline}</h2>
        <p className="article-dek">{article.dek}</p>
      </header>

      <div className="article-body">
        {article.paragraphs.length > 0 && (
          <ArticleParagraph parts={article.paragraphs[0]} onNavigate={onNavigate} />
        )}

        <figure className="article-figure article-figure-float">
          <ChartPanel>
            <PlotlyChart
              data={chartData}
              layout={chartLayout}
              remountKey={chartRemountKey}
            />
          </ChartPanel>
          <figcaption>{article.figureCaption}</figcaption>
        </figure>

        {article.paragraphs.slice(1).map((parts, i) => (
          <ArticleParagraph key={i + 1} parts={parts} onNavigate={onNavigate} />
        ))}
      </div>
    </article>
  );
}
