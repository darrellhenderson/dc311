import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import {
  resolveEstimateSessionEntry,
  trackEstimateClear,
  trackEstimateLookup,
  trackEstimatePageView,
  trackEstimateRefine,
  trackEstimateResultView,
  trackEstimateSearch,
  trackEstimateSessionStart,
  trackEstimateTryAnother,
  trackEstimateWaitDays,
  type EstimateResultMode,
  type EstimateVerdictTone,
} from '../../lib/analytics';
import {
  buildEstimateLookup,
  buildEstimateSearchParams,
  buildTicketIndex,
  decodeWardFromUrl,
  getQuickPickServiceTypes,
  getWardStandoutTypes,
  getCitywideExploreTypes,
  lookupEstimate,
  normalizeTicketId,
  parseEstimateSearchParams,
  personalVerdict,
  typeOnlySummary,
  summarizeServiceTypeStats,
  ticketFromRequest,
  TicketInfo,
} from '../../lib/estimateData';
import {
  buildReplayPrompt,
} from '../../lib/estimateReplay';
import EstimateInput from './EstimateInput';
import EstimateEmptyResultCard from './EstimateEmptyResultCard';
import EstimateReplayCard from './EstimateReplayCard';
import EstimateResultCard from './EstimateResultCard';

function syncEstimateUrl(
  ticket: TicketInfo | null,
  serviceType: string | null,
  ward: string,
  waitDays: number | null,
  usePush: boolean,
) {
  const params = buildEstimateSearchParams({
    ticket: ticket?.id ?? null,
    serviceType: ticket ? null : serviceType,
    ward: ward || null,
    waitDays: ticket ? null : waitDays,
  });
  const next = `${window.location.pathname}?${params.toString()}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current !== next) {
    const writeUrl = usePush
      ? window.history.pushState.bind(window.history)
      : window.history.replaceState.bind(window.history);
    writeUrl(null, '', next);
  }
}

export default function EstimateTab() {
  const { data, isLoading, datePreset, setDatePreset } = useDashboard();
  const [serviceType, setServiceType] = useState<string | null>(null);
  const [ward, setWard] = useState('');
  const [ticket, setTicket] = useState<TicketInfo | null>(null);
  const [waitDays, setWaitDays] = useState<number | null>(null);
  const [failedTicketId, setFailedTicketId] = useState<string | null>(null);
  const [failedServiceType, setFailedServiceType] = useState<string | null>(null);
  const [urlReady, setUrlReady] = useState(false);
  const [replayToken, setReplayToken] = useState(0);
  const inputSectionRef = useRef<HTMLDivElement>(null);

  const manifest = data?.manifest;
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const ticketIndex = useMemo(() => buildTicketIndex(rows), [rows]);
  const estimateUrlHistoryMode = useRef<'replace' | 'push'>('replace');

  const estimateLookup = useMemo(
    () => (manifest ? buildEstimateLookup(manifest) : null),
    [manifest],
  );

  const effectiveServiceType = ticket?.serviceType ?? serviceType;
  const effectiveWard = ward || null;

  const lookupResult = useMemo(() => {
    if (!estimateLookup || !effectiveServiceType) return null;
    return lookupEstimate(estimateLookup, effectiveServiceType, effectiveWard);
  }, [estimateLookup, effectiveServiceType, effectiveWard]);

  const typeStats = useMemo(() => {
    if (!effectiveServiceType) return null;
    return summarizeServiceTypeStats(rows, effectiveServiceType);
  }, [rows, effectiveServiceType]);

  const urlHydrated = useRef(false);
  const sessionStarted = useRef(false);
  const initialUrlEventsTracked = useRef(false);
  const resultViewKey = useRef<string | null>(null);
  const lastPageViewKey = useRef<string | null>(null);
  const initialSearchParams = useRef(
    parseEstimateSearchParams(new window.URLSearchParams(window.location.search)),
  );
  const datePresetOnMount = useRef(datePreset);

  const hydrateFromUrl = useCallback(() => {
    if (!manifest) return false;

    const parsed = parseEstimateSearchParams(new window.URLSearchParams(window.location.search));
    const hasEstimateParams = Boolean(parsed.ticket || parsed.serviceType);
    if (!hasEstimateParams) {
      setServiceType(null);
      setTicket(null);
      setWard('');
      setWaitDays(null);
      setFailedTicketId(null);
      setFailedServiceType(null);
      return true;
    }

    if (parsed.ticket) {
      if (datePreset !== 'full' || isLoading) return false;
      if (rows.length === 0) return false;

      const normalized = normalizeTicketId(parsed.ticket);
      const match = ticketIndex.get(normalized) ?? ticketIndex.get(parsed.ticket);
      if (match) {
        const found = ticketFromRequest(match);
        setFailedTicketId(null);
        setFailedServiceType(null);
        setTicket(found);
        setServiceType(found.serviceType);
        const wardFromUrl = parsed.ward != null
          ? decodeWardFromUrl(parsed.ward, true)
          : found.ward;
        setWard(
          wardFromUrl === '' || manifest.dictionaries.wards.includes(wardFromUrl)
            ? wardFromUrl
            : found.ward,
        );
        setWaitDays(null);
        return true;
      }

      setFailedTicketId(parsed.ticket);
      setFailedServiceType(null);
      setTicket(null);
      setServiceType(null);
      setWard('');
      setWaitDays(null);
      return true;
    }

    if (parsed.serviceType) {
      if (!manifest.dictionaries.serviceTypes.includes(parsed.serviceType)) {
        setFailedServiceType(parsed.serviceType);
        setFailedTicketId(null);
        setServiceType(null);
        setTicket(null);
        setWard('');
        setWaitDays(null);
        return true;
      }

      setFailedTicketId(null);
      setFailedServiceType(null);
      setServiceType(parsed.serviceType);
      setWard(parsed.ward && manifest.dictionaries.wards.includes(parsed.ward) ? parsed.ward : '');
      setWaitDays(parsed.waitDays ?? null);
      setTicket(null);
      return true;
    }

    return true;
  }, [manifest, rows.length, ticketIndex, datePreset, isLoading]);

  // Estimate rows and ticket index use the full-year shard set.
  useEffect(() => {
    const previous = datePresetOnMount.current;
    if (previous !== 'full') {
      setDatePreset('full');
    }
    return () => {
      if (previous !== 'full') {
        setDatePreset(previous);
      }
    };
  }, [setDatePreset]);

  useEffect(() => {
    if (!manifest || urlHydrated.current) return;
    if (!hydrateFromUrl()) return;
    urlHydrated.current = true;
    setUrlReady(true);
  }, [manifest, hydrateFromUrl]);

  useEffect(() => {
    const onPopState = () => {
      estimateUrlHistoryMode.current = 'replace';
      if (hydrateFromUrl()) {
        setUrlReady(true);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [hydrateFromUrl]);

  useEffect(() => {
    if (!urlReady) return;
    syncEstimateUrl(
      ticket,
      serviceType,
      ward,
      waitDays,
      estimateUrlHistoryMode.current === 'push',
    );
    estimateUrlHistoryMode.current = 'push';
  }, [urlReady, ticket, serviceType, ward, waitDays]);

  useEffect(() => {
    if (!urlReady || sessionStarted.current) return;
    sessionStarted.current = true;
    const parsed = initialSearchParams.current;
    trackEstimateSessionStart(
      resolveEstimateSessionEntry(Boolean(parsed.ticket || parsed.serviceType)),
    );
  }, [urlReady]);

  useEffect(() => {
    if (!urlReady || initialUrlEventsTracked.current) return;
    const parsed = initialSearchParams.current;
    if (parsed.ticket) {
      if (!ticket && !failedTicketId) return;
      initialUrlEventsTracked.current = true;
      trackEstimateLookup(ticket !== null);
      return;
    }
    initialUrlEventsTracked.current = true;
    if (parsed.serviceType) {
      trackEstimateSearch('url', Boolean(parsed.ward));
    }
  }, [urlReady, ticket, failedTicketId]);

  useEffect(() => {
    if (!urlReady) return;
    const key = [
      ticket ? 'ticket' : serviceType ? 'type' : 'idle',
      ward ? 'ward' : 'citywide',
      waitDays != null && waitDays > 0 ? 'wait' : 'nowait',
    ].join('|');
    if (key === lastPageViewKey.current) return;
    lastPageViewKey.current = key;
    trackEstimatePageView(key !== 'idle|citywide|nowait');
  }, [urlReady, ticket, serviceType, ward, waitDays]);

  useEffect(() => {
    if (!effectiveServiceType || (!lookupResult && !typeStats)) return;

    const mode: EstimateResultMode = ticket
      ? 'ticket'
      : waitDays != null && waitDays > 0
        ? 'wait_days'
        : 'type_only';
    const viewKey = [
      lookupResult ? 'estimate' : 'empty',
      mode,
      ward ? 'ward' : 'citywide',
    ].join('|');
    if (viewKey === resultViewKey.current) return;
    resultViewKey.current = viewKey;

    let verdictTone: EstimateVerdictTone = 'neutral';
    if (lookupResult) {
      if (mode === 'type_only') {
        verdictTone = typeOnlySummary(lookupResult.estimate).tone;
      } else {
        verdictTone = personalVerdict(lookupResult.estimate, { ticket, waitDays })?.tone ?? 'neutral';
      }
    }

    trackEstimateResultView({
      mode,
      has_estimate: Boolean(lookupResult),
      verdict_tone: verdictTone,
      has_ward: Boolean(ward),
    });
  }, [effectiveServiceType, lookupResult, typeStats, ticket, waitDays, ward]);

  useEffect(() => {
    if (!effectiveServiceType) {
      document.title = '311: DC\u2019s To-Do List';
      return;
    }
    const ward = effectiveWard ? ` in ${effectiveWard}` : '';
    document.title = `${effectiveServiceType}${ward} \u2014 311: DC\u2019s To-Do List`;
    return () => { document.title = '311: DC\u2019s To-Do List'; };
  }, [effectiveServiceType, effectiveWard]);

  const handleWardChange = useCallback((next: string) => {
    estimateUrlHistoryMode.current = 'push';
    setWard((prev) => {
      if (prev !== next) trackEstimateRefine(Boolean(next));
      return next;
    });
  }, []);

  const handleServiceTypeSelected = useCallback((type: string) => {
    estimateUrlHistoryMode.current = 'push';
    setFailedTicketId(null);
    setFailedServiceType(null);
    setServiceType(type);
    setTicket(null);
    setWaitDays(null);
  }, []);

  const handleReplayTypeSelected = useCallback((type: string) => {
    trackEstimateSearch('replay', Boolean(ward));
    handleServiceTypeSelected(type);
  }, [handleServiceTypeSelected, ward]);

  const handleTicketFound = useCallback((found: TicketInfo) => {
    estimateUrlHistoryMode.current = 'push';
    setFailedTicketId(null);
    setTicket(found);
    setServiceType(found.serviceType);
    setWard(found.ward);
    setWaitDays(null);
  }, []);

  const handleWaitDaysChange = useCallback((days: number | null) => {
    estimateUrlHistoryMode.current = 'push';
    setWaitDays((prev) => {
      if (prev !== days) trackEstimateWaitDays(days);
      return days;
    });
  }, []);

  const handleTicketCleared = useCallback(() => {
    estimateUrlHistoryMode.current = 'push';
    setTicket(null);
    setFailedTicketId(null);
  }, []);

  const handleClearAll = useCallback(() => {
    estimateUrlHistoryMode.current = 'push';
    trackEstimateClear('all');
    resultViewKey.current = null;
    setServiceType(null);
    setTicket(null);
    setWaitDays(null);
    setFailedTicketId(null);
    setFailedServiceType(null);
    setWard('');
  }, []);

  const handleTryAnother = useCallback(() => {
    setServiceType(null);
    setTicket(null);
    setWaitDays(null);
    setFailedTicketId(null);
    setFailedServiceType(null);
    resultViewKey.current = null;
    trackEstimateTryAnother(Boolean(ward));
    setReplayToken((token) => token + 1);
    window.requestAnimationFrame(() => {
      inputSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // Keep ward when clearing service type so users can compare types in the same ward.
  }, [ward]);

  const builtAt = manifest?.builtAt
    ? new Date(manifest.builtAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  const quickPicks = useMemo(
    () => (manifest ? getQuickPickServiceTypes(manifest, 8) : []),
    [manifest],
  );

  const wardStandouts = useMemo(
    () => (manifest && ward ? getWardStandoutTypes(manifest, ward, 3) : []),
    [manifest, ward],
  );

  const citywideExploreTypes = useMemo(
    () => (
      manifest && effectiveServiceType
        ? getCitywideExploreTypes(manifest, effectiveServiceType, 3)
        : []
    ),
    [manifest, effectiveServiceType],
  );

  const serviceCategory = effectiveServiceType && manifest
    ? manifest.categoryMap[effectiveServiceType] ?? null
    : null;

  const replayPrompt = useMemo(() => {
    if (!effectiveServiceType || ticket) return null;
    if (waitDays != null && waitDays > 0) return null;
    return buildReplayPrompt({
      serviceType: effectiveServiceType,
      ward: effectiveWard,
      lookup: lookupResult,
      wardStandouts,
      citywideExploreTypes,
      category: serviceCategory,
    });
  }, [
    lookupResult,
    effectiveServiceType,
    effectiveWard,
    ticket,
    waitDays,
    wardStandouts,
    citywideExploreTypes,
    serviceCategory,
  ]);

  const showWardGuide = Boolean(
    effectiveServiceType
    && !ward
    && !ticket
    && (waitDays == null || waitDays <= 0),
  );

  const isTypeOnlyLookup = !ticket && (waitDays == null || waitDays <= 0);
  const showReplayCard = isTypeOnlyLookup && Boolean(effectiveServiceType && replayPrompt);
  const replayTitle = ward ? `More in ${ward}` : 'Other types';

  if (isLoading || !manifest) {
    return (
      <div className="p-4 flex items-center space-x-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
        <span className="text-sm text-text-muted">Loading estimate data…</span>
      </div>
    );
  }

  if (!manifest.estimates?.length) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900 text-sm">
        Estimate data is not available yet. Rebuild dashboard data with the latest build script.
      </div>
    );
  }

  return (
    <div>
      <div ref={inputSectionRef}>
        <EstimateInput
          serviceTypes={manifest.dictionaries.serviceTypes}
          categoryMap={manifest.categoryMap}
          wards={manifest.dictionaries.wards}
          rows={rows}
          selectedServiceType={effectiveServiceType}
          selectedWard={ward}
          ticket={ticket}
          failedTicketId={failedTicketId}
          failedServiceType={failedServiceType}
          quickPicks={quickPicks}
          wardStandouts={wardStandouts}
          replayToken={replayToken}
          showWardGuide={showWardGuide}
          onServiceTypeSelected={handleServiceTypeSelected}
          onTicketFound={handleTicketFound}
          onTicketCleared={handleTicketCleared}
          onClearAll={handleClearAll}
          onWardChange={handleWardChange}
        />
      </div>

      {failedServiceType && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
          Unknown service type &ldquo;{failedServiceType}&rdquo; &mdash; pick a type from search above.
        </div>
      )}

      {lookupResult && effectiveServiceType && (
        <EstimateResultCard
          lookup={lookupResult}
          ward={effectiveWard}
          ticket={ticket}
          builtAt={builtAt}
          serviceType={effectiveServiceType}
          category={serviceCategory}
          typeStats={typeStats}
          datePreset={datePreset}
          waitDays={waitDays}
          onWaitDaysChange={handleWaitDaysChange}
          rows={rows}
          onTicketFound={handleTicketFound}
          onTryAnother={handleTryAnother}
        />
      )}

      {!lookupResult && effectiveServiceType && typeStats && (
        <EstimateEmptyResultCard
          serviceType={effectiveServiceType}
          typeStats={typeStats}
          ward={ward}
          showTryAnother={isTypeOnlyLookup}
          onTryAnother={handleTryAnother}
        />
      )}

      {showReplayCard && (
        <EstimateReplayCard
          title={replayTitle}
          promptLine={replayPrompt?.promptLine}
          suggestTypes={replayPrompt?.suggestTypes ?? []}
          onSelectType={handleReplayTypeSelected}
        />
      )}
    </div>
  );
}
