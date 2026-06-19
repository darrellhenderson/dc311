import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchDashboardData } from './api/data';
import { DateRangePreset } from './api/dataTypes';
import AboutPanel from './components/shell/AboutPanel';
import AppFooter from './components/shell/AppFooter';
import AppHeader from './components/shell/AppHeader';
import TabNav from './components/shell/TabNav';
import { DashboardProvider } from './context/DashboardContext';
import { trackAboutOpen, trackEvent } from './lib/analytics';
import { ESTIMATE_URL_KEYS, resolveTabFromSearchParams, stripEstimateSearchParams } from './lib/estimateRouting';
import { TabId } from './lib/site';

const OverviewTab = lazy(() => import('./components/overview/OverviewTab'));
const EstimateTab = lazy(() => import('./components/estimate/EstimateTab'));
const SLATab = lazy(() => import('./components/sla/SLATab'));
const ExplorerTab = lazy(() => import('./components/explorer/ExplorerTab'));
const RawDataTab = lazy(() => import('./components/raw/RawDataTab'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 24 * 60 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

function TabFallback() {
  return (
    <div className="p-4 flex items-center space-x-2">
      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
      <span className="text-sm text-text-muted">Loading tab…</span>
    </div>
  );
}

function readInitialTab(): TabId {
  return resolveTabFromSearchParams(new window.URLSearchParams(window.location.search));
}

function DashboardShell() {
  const [activeTab, setActiveTab] = useState<TabId>(readInitialTab);
  const [datePreset, setDatePreset] = useState<DateRangePreset>('full');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number; currentShard: string } | null>(null);
  const tabHistoryMode = useRef<'replace' | 'push'>('replace');

  const handleTabChange = useCallback((tab: TabId) => {
    tabHistoryMode.current = 'push';
    setActiveTab((current) => {
      if (current === tab) {
        return current;
      }
      trackEvent('tab_view', { tab });
      return tab;
    });
  }, []);

  useEffect(() => {
    trackEvent('tab_view', { tab: readInitialTab() });
  }, []);

  useEffect(() => {
    const onPopState = () => {
      tabHistoryMode.current = 'replace';
      const tab = readInitialTab();
      setActiveTab(tab);
      trackEvent('tab_view', { tab });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const params = new window.URLSearchParams(window.location.search);

    if (activeTab === 'overview') {
      const hasEstimateState = ESTIMATE_URL_KEYS.some((key) => params.has(key));
      if (hasEstimateState) {
        if (params.get('tab') === 'overview') return;
        params.set('tab', 'overview');
        const url = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState(null, '', url);
        return;
      }
      const url = window.location.pathname;
      if (window.location.search) {
        window.history.replaceState(null, '', url);
      }
      return;
    }

    if (activeTab !== 'estimate') {
      stripEstimateSearchParams(params);
    }

    params.set('tab', activeTab);

    const next = `${window.location.pathname}?${params.toString()}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (current === next) return;

    const writeUrl = tabHistoryMode.current === 'push'
      ? window.history.pushState.bind(window.history)
      : window.history.replaceState.bind(window.history);
    writeUrl(null, '', next);
    tabHistoryMode.current = 'push';
  }, [activeTab]);

  const handleDatePresetChange = useCallback((preset: DateRangePreset) => {
    setDatePreset((current) => {
      if (current === preset) {
        return current;
      }
      trackEvent('date_range_change', { preset });
      return preset;
    });
  }, []);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['dashboardData', datePreset],
    queryFn: () => fetchDashboardData(datePreset, setLoadProgress),
  });

  useEffect(() => {
    if (!error) {
      return;
    }
    trackEvent('data_load_error', {
      message: (error as Error).message.slice(0, 100),
    });
  }, [error]);

  const handleAboutOpen = useCallback(() => {
    setAboutOpen(true);
    trackAboutOpen();
  }, []);

  const isLoadingRows = activeTab === 'raw' && (isLoading || isFetching);

  const builtAt = data?.manifest.builtAt
    ? new Date(data.manifest.builtAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  // Overview always uses the full-year timeline; reflect that in the header label.
  const dateLabel = datePreset === '90d' && activeTab !== 'overview' ? 'Last 90 days' : 'Full year';
  const rowCount = data?.rows.length ?? 0;

  const dashboardValue = useMemo(
    () => ({
      data,
      isLoading,
      isLoadingRows,
      error: error as Error | null,
      datePreset,
      setDatePreset: handleDatePresetChange,
      loadProgress,
      activeTab,
      setActiveTab: handleTabChange,
    }),
    [data, isLoading, isLoadingRows, error, datePreset, loadProgress, activeTab, handleDatePresetChange, handleTabChange],
  );

  if (error) {
    return (
      <div className="min-h-screen bg-surface-muted p-4">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h3 className="font-semibold text-red-800 mb-2">Error loading data</h3>
            <p className="text-red-600 text-sm">{(error as Error).message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <DashboardProvider value={dashboardValue}>
      <div className="min-h-screen bg-surface-muted flex flex-col">
        <AppHeader
          builtAt={builtAt}
          rowCount={rowCount}
          dateLabel={dateLabel}
          isLoading={isLoading}
          loadProgress={loadProgress}
        />

        <TabNav activeTab={activeTab} onTabChange={handleTabChange} />

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-3">
          {isLoading ? (
            <div className="p-4 flex items-center space-x-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
              <span className="text-sm text-text-muted">Loading dashboard data…</span>
            </div>
          ) : (
            <Suspense fallback={<TabFallback />}>
              {activeTab === 'overview' && <OverviewTab />}
              {activeTab === 'estimate' && <EstimateTab />}
              {activeTab === 'sla' && <SLATab />}
              {activeTab === 'explorer' && <ExplorerTab />}
              {activeTab === 'raw' && <RawDataTab />}
            </Suspense>
          )}
        </main>

        <AppFooter onAboutClick={handleAboutOpen} />

        <AboutPanel
          open={aboutOpen}
          builtAt={builtAt}
          onClose={() => setAboutOpen(false)}
        />
      </div>
    </DashboardProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DashboardShell />
    </QueryClientProvider>
  );
}

export default App;
