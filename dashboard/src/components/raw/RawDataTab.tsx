import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { filterExplorerRows, EMPTY_EXPLORER_FILTERS, ExplorerFilterState, summarizeExplorerFilterDimensions } from '../../lib/filterTypes';
import { trackFilterChange } from '../../lib/analytics';
import { useTrackFilterTabPageView } from '../../hooks/useTrackFilterTabPageView';
import { ProcessedRequest } from '../../lib/dataProcessing';
import { useIsMobile } from '../../hooks/useBreakpoint';
import ExplorerFilterBar from '../shared/filters/ExplorerFilterBar';
import ScrollHint from '../shared/ScrollHint';

const ROW_HEIGHT = 36;
const CARD_HEIGHT = 96;
const VISIBLE_BUFFER = 5;

interface RawColumn {
  key: keyof ProcessedRequest;
  label: string;
  width: string;
}

const RAW_COLUMNS: RawColumn[] = [
  { key: 'SERVICEREQUESTID', label: 'Request ID', width: '7%' },
  { key: 'ADDDATE', label: 'Added', width: '8%' },
  { key: 'RESOLUTIONDATE', label: 'Resolved', width: '8%' },
  { key: 'SERVICEDUEDATE', label: 'Due', width: '7%' },
  { key: 'SERVICECODEDESCRIPTION', label: 'Service type', width: '16%' },
  { key: 'ORGANIZATIONACRONYM', label: 'Agency', width: '6%' },
  { key: 'SERVICEORDERSTATUS', label: 'Status', width: '8%' },
  { key: 'STREETADDRESS', label: 'Address', width: '14%' },
  { key: 'WARD', label: 'Ward', width: '4%' },
  { key: 'category', label: 'Category', width: '9%' },
  { key: 'age_days', label: 'Age (days)', width: '6%' },
  { key: 'resolution_days', label: 'Resolved (d)', width: '7%' },
];

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toString() : value.toFixed(2);
  }
  return String(value);
}

function formatDateShort(value: unknown): string {
  if (!(value instanceof Date)) return formatValue(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export default function RawDataTab() {
  const { data: dashboardData, datePreset } = useDashboard();
  const processed = dashboardData?.rows;
  const isMobile = useIsMobile();

  const [filters, setFilters] = useState<ExplorerFilterState>(EMPTY_EXPLORER_FILTERS);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleFilterChange = useCallback((next: ExplorerFilterState) => {
    setFilters((prev) => {
      trackFilterChange(
        'raw',
        summarizeExplorerFilterDimensions(prev),
        summarizeExplorerFilterDimensions(next),
      );
      return next;
    });
  }, []);

  const filterSummary = summarizeExplorerFilterDimensions(filters);
  useTrackFilterTabPageView('raw', filterSummary);

  const filtered = useMemo(() => {
    if (!processed) return [];
    return filterExplorerRows(processed, filters);
  }, [processed, filters]);

  const onScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
  }, []);

  useEffect(() => {
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [isMobile]);

  const containerHeight = isMobile ? 420 : 480;
  const itemHeight = isMobile ? CARD_HEIGHT : ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / itemHeight) - VISIBLE_BUFFER);
  const endIdx = Math.min(filtered.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + VISIBLE_BUFFER);
  const visibleRows = filtered.slice(startIdx, endIdx);

  if (!processed || processed.length === 0) {
    return <div className="p-4">No data available</div>;
  }

  return (
    <div>
      <p className="prose-paragraph mb-3">
        Individual 311 service requests from DC Open Data. Addresses are public record. Requests without a due date appear here but are excluded from SLA calculations elsewhere.
      </p>

      {datePreset === 'full' && filtered.length > 50000 && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-3 text-sm text-amber-800">
          Showing {filtered.length.toLocaleString()} records. Narrow the date range or apply filters for faster browsing.
        </div>
      )}

      <ExplorerFilterBar
        rows={processed}
        filters={filters}
        onChange={handleFilterChange}
      />

      <div className="bg-white rounded-lg shadow-sm p-4 border border-border">
        <h3 className="text-lg font-semibold mb-3">
          {isMobile ? 'Records' : 'Raw Data'} ({filtered.length.toLocaleString()} records)
        </h3>

        {isMobile ? (
          <div
            key="records-cards"
            ref={scrollRef}
            onScroll={onScroll}
            className="font-mono overflow-auto border border-gray-200 rounded scrollbar-thin"
            style={{ height: containerHeight }}
          >
            {startIdx > 0 && <div style={{ height: startIdx * CARD_HEIGHT }} aria-hidden="true" />}
            {visibleRows.map((r) => (
              <div
                key={r.SERVICEREQUESTID}
                className="border-b border-border px-3 py-2"
                style={{ minHeight: CARD_HEIGHT }}
              >
                <p className="text-sm font-semibold mb-0.5 truncate">{r.SERVICECODEDESCRIPTION}</p>
                <p className="text-caption text-text-muted mb-0.5">
                  {r.SERVICEORDERSTATUS} · Ward {r.WARD ?? '—'} · {formatDateShort(r.ADDDATE)}
                </p>
                <p className="text-caption text-text-muted mb-0 truncate">
                  #{r.SERVICEREQUESTID}
                  {r.STREETADDRESS ? ` · ${r.STREETADDRESS}` : ''}
                </p>
              </div>
            ))}
            {endIdx < filtered.length && (
              <div style={{ height: (filtered.length - endIdx) * CARD_HEIGHT }} aria-hidden="true" />
            )}
          </div>
        ) : (
          <>
            <ScrollHint />
            <div
              key="records-table"
              ref={scrollRef}
              onScroll={onScroll}
              className="font-mono overflow-auto border border-gray-200 rounded scrollbar-thin"
              style={{ height: containerHeight }}
            >
              <table className="w-full text-sm table-fixed min-w-[1200px]">
                <colgroup>
                  {RAW_COLUMNS.map((col) => (
                    <col key={col.key} style={{ width: col.width }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-100">
                    {RAW_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        title={col.key}
                        className="px-2 py-1.5 text-left font-semibold text-xs leading-snug whitespace-normal border-b border-gray-200"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {startIdx > 0 && (
                    <tr aria-hidden="true" style={{ height: startIdx * ROW_HEIGHT }}>
                      <td colSpan={RAW_COLUMNS.length} className="p-0 border-none" />
                    </tr>
                  )}
                  {visibleRows.map((r, idx) => (
                    <tr
                      key={r.SERVICEREQUESTID}
                      className={(startIdx + idx) % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                      style={{ height: ROW_HEIGHT }}
                    >
                      {RAW_COLUMNS.map((col) => (
                        <td key={col.key} className="px-2 py-1 text-left whitespace-nowrap overflow-hidden text-ellipsis border-b border-gray-100">
                          {formatValue(r[col.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {endIdx < filtered.length && (
                    <tr aria-hidden="true" style={{ height: (filtered.length - endIdx) * ROW_HEIGHT }}>
                      <td colSpan={RAW_COLUMNS.length} className="p-0 border-none" />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
