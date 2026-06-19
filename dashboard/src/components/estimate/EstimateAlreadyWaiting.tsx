import { useCallback, useMemo, useState } from 'react';
import { ProcessedRequest } from '../../lib/dataProcessing';
import {
  buildTicketIndex,
  normalizeTicketId,
  ticketFromRequest,
  TicketInfo,
} from '../../lib/estimateData';
import { trackEstimateLookup } from '../../lib/analytics';

interface EstimateAlreadyWaitingProps {
  rows: ProcessedRequest[];
  waitDays: number | null;
  onWaitDaysChange: (days: number | null) => void;
  onTicketFound: (ticket: TicketInfo) => void;
}

export default function EstimateAlreadyWaiting({
  rows,
  waitDays,
  onWaitDaysChange,
  onTicketFound,
}: EstimateAlreadyWaitingProps) {
  const [ticketQuery, setTicketQuery] = useState('');
  const [notFound, setNotFound] = useState(false);

  const ticketIndex = useMemo(() => buildTicketIndex(rows), [rows]);

  const tryTicketLookup = useCallback(() => {
    const trimmed = ticketQuery.trim();
    if (!trimmed) return;

    const normalized = normalizeTicketId(trimmed);
    const match = ticketIndex.get(normalized) ?? ticketIndex.get(trimmed);
    if (match) {
      setNotFound(false);
      onTicketFound(ticketFromRequest(match));
      trackEstimateLookup(true);
      return;
    }

    trackEstimateLookup(false);
    setNotFound(true);
  }, [ticketIndex, ticketQuery, onTicketFound]);

  return (
    <div>
      <p className="text-caption font-semibold text-text-muted mb-1">Already waiting?</p>
      <p className="text-caption text-text-muted mb-3">
        Paste your ticket # or enter days open to see where you stand vs similar requests.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 sm:items-end">
        <div>
          <label htmlFor="estimate-ticket-id" className="text-caption text-text-muted block mb-1">
            Ticket #
          </label>
          <input
            id="estimate-ticket-id"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 25-00345678"
            className="w-full text-body border border-border rounded-md px-3 py-2 min-h-[44px] bg-surface font-mono tabular-nums"
            value={ticketQuery}
            onChange={(e) => {
              setTicketQuery(e.target.value);
              setNotFound(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                tryTicketLookup();
              }
            }}
          />
        </div>

        <p className="text-caption text-text-muted text-center sm:pb-2.5 mb-0">or</p>

        <div>
          <label htmlFor="estimate-wait-days" className="text-caption text-text-muted block mb-1">
            Days open
          </label>
          <input
            id="estimate-wait-days"
            type="number"
            min={0}
            max={999}
            placeholder="e.g. 12"
            className="w-full text-body border border-border rounded-md px-3 py-2 min-h-[44px] bg-surface tabular-nums"
            value={waitDays ?? ''}
            onChange={(e) => {
              const val = e.target.value === '' ? null : Number(e.target.value);
              onWaitDaysChange(val != null && !Number.isNaN(val) ? val : null);
            }}
          />
        </div>
      </div>

      {notFound && (
        <p className="mt-2 text-caption text-amber-800 mb-0">
          Ticket not found — it may be older than one year.
        </p>
      )}
    </div>
  );
}
