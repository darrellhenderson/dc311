import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Suspense, lazy, useMemo, useState } from 'react';
import { fetchDashboardData } from './api/data';
import { DateRangePreset } from './api/dataTypes';
import AboutPanel from './components/shell/AboutPanel';
import AppFooter from './components/shell/AppFooter';
import AppHeader from './components/shell/AppHeader';
import TabNav from './components/shell/TabNav';
import { DashboardProvider } from './context/DashboardContext';

const OverviewTab = lazy(() => import('./components/overview/OverviewTab'));
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

function DashboardShell() {
  const [activeTab, setActiveTab] = useState<'overview' | 'sla' | 'explorer' | 'raw'>('overview');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('full');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number; currentShard: string } | null>(null);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['dashboardData', datePreset],
    queryFn: () => fetchDashboardData(datePreset, setLoadProgress),
  });

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
      setDatePreset,
      loadProgress,
      activeTab,
      setActiveTab,
    }),
    [data, isLoading, isLoadingRows, error, datePreset, loadProgress, activeTab],
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

        <TabNav activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-3">
          {isLoading ? (
            <div className="p-4 flex items-center space-x-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
              <span className="text-sm text-text-muted">Loading dashboard data…</span>
            </div>
          ) : (
            <Suspense fallback={<TabFallback />}>
              {activeTab === 'overview' && <OverviewTab />}
              {activeTab === 'sla' && <SLATab />}
              {activeTab === 'explorer' && <ExplorerTab />}
              {activeTab === 'raw' && <RawDataTab />}
            </Suspense>
          )}
        </main>

        <AppFooter onAboutClick={() => setAboutOpen(true)} />

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
