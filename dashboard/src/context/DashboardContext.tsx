import { createContext, useContext, ReactNode } from 'react';
import { DashboardData, DateRangePreset, LoadProgress } from '../api/dataTypes';

export interface DashboardContextValue {
  data: DashboardData | undefined;
  isLoading: boolean;
  isLoadingRows: boolean;
  error: Error | null;
  datePreset: DateRangePreset;
  setDatePreset: (preset: DateRangePreset) => void;
  loadProgress: LoadProgress | null;
  activeTab: 'overview' | 'sla' | 'explorer' | 'raw';
  setActiveTab: (tab: 'overview' | 'sla' | 'explorer' | 'raw') => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: DashboardContextValue;
}) {
  return (
    <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}
