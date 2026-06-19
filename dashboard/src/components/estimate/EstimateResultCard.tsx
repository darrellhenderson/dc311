import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildEstimateShareImagePath,
  buildEstimateShareUrl,
  buildEstimateStaticShareUrl,
  buildShareClipboard,
  buildShareText,
  confidenceVerdict,
  estimateShareSlug,
  formatDays,
  formatHeadlineRange,
  formatResolutionLine,
  formatSampleSubline,
  generateOutcomeSentences,
  getWardComparison,
  estimateBarEnd,
  LookupEstimateResult,
  personalVerdict,
  typeOnlySummary,
  ServiceTypeStats,
  TicketInfo,
} from '../../lib/estimateData';
import { trackEstimateCopyLink, trackEstimateDetailExpand, trackEstimateOutboundClick, trackEstimateSaveImage, trackEstimateShare, trackEstimateSlaBridge } from '../../lib/analytics';
import { useDashboard } from '../../context/DashboardContext';
import { setPendingSlaFilters } from '../../lib/slaHandoff';
import { DateRangePreset } from '../../api/dataTypes';
import { ProcessedRequest } from '../../lib/dataProcessing';
import EstimateAlreadyWaiting from './EstimateAlreadyWaiting';
import PersonalVerdictBanner from './PersonalVerdictBanner';
import StickyVerdictBar from './StickyVerdictBar';
import TimelineStrip from './TimelineStrip';
import WardComparisonCallout from './WardComparisonCallout';
import WardFallbackCallout from './WardFallbackCallout';

const DC311_URL = 'https://311.dc.gov';
const DC_COUNCIL_URL = 'https://dccouncil.gov/councilmembers/';

interface EstimateResultCardProps {
  lookup: LookupEstimateResult;
  ward: string | null;
  ticket: TicketInfo | null;
  builtAt: string | null;
  serviceType: string;
  category: string | null;
  typeStats: ServiceTypeStats | null;
  datePreset: DateRangePreset;
  waitDays: number | null;
  onWaitDaysChange: (days: number | null) => void;
  rows: ProcessedRequest[];
  onTicketFound: (ticket: TicketInfo) => void;
  onTryAnother: () => void;
}

export default function EstimateResultCard({
  lookup,
  ward,
  ticket,
  builtAt,
  serviceType,
  category,
  typeStats,
  datePreset,
  waitDays,
  onWaitDaysChange,
  rows,
  onTicketFound,
  onTryAnother,
}: EstimateResultCardProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [imageSaving, setImageSaving] = useState(false);
  const [imageSaveFailed, setImageSaveFailed] = useState(false);
  const [showSharePreview, setShowSharePreview] = useState(false);
  const [verdictVisible, setVerdictVisible] = useState(true);
  const verdictRef = useRef<HTMLDivElement>(null);
  const { setActiveTab } = useDashboard();
  const { estimate, citywideEstimate, wardEstimate, usedWardFallback } = lookup;
  const verdict = confidenceVerdict(estimate.pct_met_sla);
  const personal = useMemo(
    () => personalVerdict(estimate, { ticket, waitDays }),
    [estimate, ticket, waitDays],
  );
  const isTypeOnly = personal === null;
  const typeOnly = isTypeOnly ? typeOnlySummary(estimate) : null;
  const markerDays = ticket?.markerDays ?? waitDays;
  const sampleSubline = formatSampleSubline(estimate, builtAt);
  const resolutionLine = formatResolutionLine(typeStats, datePreset);
  const outcomeOptions = {
    estimate,
    citywideEstimate,
    wardEstimate,
    ward,
    usedWardFallback,
  };
  const wardComparison = getWardComparison(outcomeOptions);
  const contextSentences = generateOutcomeSentences(outcomeOptions);
  const hasPersonalWait = ticket?.isOpen || (waitDays != null && waitDays > 0);
  const showWarningCta = personal?.tone === 'warning' && hasPersonalWait;
  const showDangerCta = personal?.tone === 'danger' && hasPersonalWait;

  const shareUrl = useMemo(() => {
    if (ticket) {
      return buildEstimateShareUrl(window.location.origin, window.location.pathname, {
        ticket: ticket.id,
        ward: ward || null,
      });
    }
    return buildEstimateStaticShareUrl(
      window.location.origin,
      import.meta.env.BASE_URL ?? '/',
      serviceType,
      ward,
    );
  }, [ticket, serviceType, ward]);

  const shareText = useMemo(
    () => buildShareText({
      serviceType,
      ward,
      lookup,
      ticket,
      waitDays: ticket ? null : waitDays,
      personal,
    }),
    [serviceType, ward, lookup, ticket, waitDays, personal],
  );

  const shareClipboard = useMemo(
    () => buildShareClipboard(shareUrl, shareText),
    [shareUrl, shareText],
  );

  const shareImagePath = useMemo(
    () => buildEstimateShareImagePath(import.meta.env.BASE_URL ?? '/', serviceType, ward),
    [serviceType, ward],
  );

  useEffect(() => {
    const node = verdictRef.current;
    if (!node || !personal) {
      setVerdictVisible(true);
      return undefined;
    }

    const mobileQuery = window.matchMedia('(max-width: 639px)');
    let observer: IntersectionObserver | null = null;

    const clearObserver = () => {
      observer?.disconnect();
      observer = null;
    };

    const syncForViewport = () => {
      if (!mobileQuery.matches) {
        clearObserver();
        setVerdictVisible(true);
        return;
      }

      clearObserver();
      observer = new IntersectionObserver(
        ([entry]) => setVerdictVisible(entry.isIntersecting),
        { threshold: 0 },
      );
      observer.observe(node);
    };

    syncForViewport();
    mobileQuery.addEventListener('change', syncForViewport);
    return () => {
      mobileQuery.removeEventListener('change', syncForViewport);
      clearObserver();
    };
  }, [personal]);

  const handleShare = useCallback(async () => {
    const shareData = {
      title: `${serviceType} \u2014 311: DC\u2019s To-Do List`,
      text: shareText,
      url: shareUrl,
    };

    if (typeof navigator.share === 'function') {
      try {
        const canShare = typeof navigator.canShare === 'function'
          ? navigator.canShare(shareData)
          : true;
        if (canShare) {
          await navigator.share(shareData);
          trackEstimateShare();
          return;
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }

    try {
      await window.navigator.clipboard.writeText(shareClipboard);
      setCopyFailed(false);
      setCopied(true);
      setShowSharePreview(true);
      trackEstimateShare();
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      setCopyFailed(true);
      setShowSharePreview(true);
      window.setTimeout(() => setCopyFailed(false), 3000);
    }
  }, [shareClipboard, shareUrl, shareText, serviceType]);

  const handleSaveImage = useCallback(async () => {
    setImageSaving(true);
    setImageSaveFailed(false);
    try {
      const res = await fetch(shareImagePath);
      if (!res.ok) throw new Error('missing');
      const contentType = res.headers.get('Content-Type') ?? '';
      if (!contentType.includes('image/png')) throw new Error('not png');
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `311-dc-${estimateShareSlug(serviceType, ward)}.png`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      trackEstimateSaveImage();
    } catch {
      setImageSaveFailed(true);
      window.setTimeout(() => setImageSaveFailed(false), 3000);
    } finally {
      setImageSaving(false);
    }
  }, [shareImagePath, serviceType, ward]);

  const handleCopySaveLink = useCallback(async () => {
    try {
      await window.navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      trackEstimateCopyLink();
      window.setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      setLinkCopied(false);
    }
  }, [shareUrl]);

  const handleSlaBridge = useCallback(() => {
    if (!ward || !category) return;
    setPendingSlaFilters({ wards: [ward], categories: [category] });
    trackEstimateSlaBridge('ward_callout');
    setActiveTab('sla');
  }, [ward, category, setActiveTab]);

  const handleOverviewLink = useCallback(() => {
    trackEstimateOutboundClick('overview');
    setActiveTab('overview');
  }, [setActiveTab]);

  const showSaveLinkNudge = Boolean(
    personal && ticket && (personal.tone === 'success' || personal.tone === 'warning'),
  );

  const saveLinkNudge = showSaveLinkNudge ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700">
      <span>Save this link to check back — it remembers your ticket.</span>
      <button
        type="button"
        onClick={handleCopySaveLink}
        className="text-blue-700 hover:text-blue-900 underline font-medium min-h-[44px]"
      >
        {linkCopied ? 'Link copied' : 'Copy link'}
      </button>
    </div>
  ) : null;

  return (
    <section className="bg-surface border border-border rounded-lg mb-2">
      <div className="px-4 py-2.5">
        <h3 className="text-body font-semibold text-gray-900 mb-0">Your estimate</h3>
        <p className="text-caption text-text-muted mb-0 mt-0.5">{serviceType}</p>
      </div>
      <div className="px-4 pb-3 border-t border-border pt-2.5">
        {personal && !verdictVisible && (
          <StickyVerdictBar headline={personal.headline} tone={personal.tone} />
        )}

        <p className="text-caption font-semibold text-text-muted uppercase tracking-wide mb-1">
          Typical for this type
        </p>
        <p className="font-mono text-4xl sm:text-5xl font-bold tabular-nums tracking-tight leading-none text-gray-900 mb-2">
          {formatHeadlineRange(estimate)}
        </p>
        <p className="font-mono text-caption text-text-muted mb-4">
          {sampleSubline}
        </p>

        <TimelineStrip estimate={estimate} markerDays={markerDays} />

        {contextSentences.length > 0 && (
          <div className="article-prose mt-4">
            {contextSentences.map((sentence, index) => (
              <p key={index} className="prose-paragraph mb-0 last:mb-0">{sentence}</p>
            ))}
          </div>
        )}

        {isTypeOnly && typeOnly && (
          <div className="mt-4">
            <PersonalVerdictBanner
              headline={verdict.label}
              detail={typeOnly.message}
              tone={typeOnly.tone}
              resolutionLine={resolutionLine}
              neutralBox
              onShare={handleShare}
            >
              <a
                href={DC311_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEstimateOutboundClick('dc311')}
                className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                File a request
              </a>
            </PersonalVerdictBanner>
          </div>
        )}

        {personal && (
          <div ref={verdictRef} className="mt-4">
            <PersonalVerdictBanner
              headline={personal.headline}
              detail={personal.detail}
              tone={personal.tone}
              resolutionLine={resolutionLine}
              onShare={handleShare}
              saveLinkNudge={saveLinkNudge}
            >
              {showDangerCta && (
                <>
                  <a
                    href={DC311_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackEstimateOutboundClick('dc311')}
                    className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    Follow up on your request
                  </a>
                  <a
                    href={DC_COUNCIL_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackEstimateOutboundClick('dc_council')}
                    className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    Find your council member
                  </a>
                </>
              )}
              {showWarningCta && (
                <a
                  href={DC311_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackEstimateOutboundClick('dc311')}
                  className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium rounded-md border border-amber-300 bg-amber-100/50 hover:bg-amber-100 transition-colors text-amber-900"
                >
                  Check status at 311.dc.gov
                </a>
              )}
              {ticket?.isClosed && (
                <>
                  <a
                    href={DC311_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackEstimateOutboundClick('dc311')}
                    className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium rounded-md border border-border bg-surface hover:bg-surface-muted transition-colors text-blue-700"
                  >
                    Need to report this again? File at 311.dc.gov
                  </a>
                  <button
                    type="button"
                    onClick={handleOverviewLink}
                    className="text-sm text-blue-700 hover:text-blue-900 underline text-center sm:text-right min-h-[44px]"
                  >
                    See how this type performs citywide →
                  </button>
                </>
              )}
            </PersonalVerdictBanner>
          </div>
        )}

        {wardComparison && (
          <WardComparisonCallout
            comparison={wardComparison}
            category={category}
            onViewSlaPerformance={category ? handleSlaBridge : undefined}
          />
        )}

        {ward && usedWardFallback && (
          <WardFallbackCallout ward={ward} />
        )}

        <div className="mt-4 pt-3 border-t border-border">
          {!ticket && (
            <EstimateAlreadyWaiting
              rows={rows}
              waitDays={waitDays}
              onWaitDaysChange={onWaitDaysChange}
              onTicketFound={onTicketFound}
            />
          )}

          <div className={`flex flex-wrap items-center gap-2${!ticket ? ' mt-4 pt-4 border-t border-border' : ''}`}>
          <button
            type="button"
            onClick={handleShare}
            className="min-h-[44px] px-3 py-2 text-sm font-medium border border-border rounded-md bg-surface hover:bg-surface-muted transition-colors"
          >
            {copied ? 'Copied \u2014 paste in your group chat' : 'Share'}
          </button>
          {!ticket && (
            <button
              type="button"
              onClick={handleSaveImage}
              disabled={imageSaving}
              className="min-h-[44px] px-3 py-2 text-sm font-medium border border-border rounded-md bg-surface hover:bg-surface-muted transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {imageSaving ? 'Saving…' : imageSaveFailed ? 'Image unavailable' : 'Save image'}
            </button>
          )}
          {!ticket && (
            <button
              type="button"
              onClick={onTryAnother}
              className="min-h-[44px] px-3 py-2 text-sm font-medium border border-border rounded-md bg-surface hover:bg-surface-muted transition-colors"
            >
              {ward ? `Check another in ${ward}` : 'Try another'}
            </button>
          )}
          </div>
        </div>
        {copyFailed && (
          <p className="mt-2 text-caption text-amber-800 mb-0">
            Could not copy — select and copy the text below.
          </p>
        )}
        {showSharePreview && (
          <div className="relative mt-3 p-3 pr-10 rounded-md bg-surface-muted border border-border text-sm text-gray-800 whitespace-pre-wrap">
            <button
              type="button"
              onClick={() => setShowSharePreview(false)}
              className="absolute top-2 right-2 text-text-muted hover:text-gray-900 text-lg leading-none min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Dismiss share preview"
            >
              ×
            </button>
            {shareClipboard}
          </div>
        )}

        <details
          className="mt-4 font-mono text-caption text-text-muted border-t border-border pt-3"
          onToggle={(event) => {
            if ((event.currentTarget as HTMLDetailsElement).open) {
              trackEstimateDetailExpand();
            }
          }}
        >
          <summary className="cursor-pointer font-medium text-gray-700">More detail</summary>
          <div className="mt-2 space-y-1">
            <p className="mb-0">
              Median {formatDays(estimate.p50)}d · 75th {formatDays(estimate.p75)}d · 95th {formatDays(estimateBarEnd(estimate))}d
            </p>
            {estimate.sla_days > 0 && (
              <p className="mb-0">
                {Math.round(estimate.pct_met_sla)}% met the {formatDays(estimate.sla_days)}-day deadline · {verdict.message}
              </p>
            )}
            <p className="mb-0 italic">
              Based on historical closed requests; does not guarantee future resolution times.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
