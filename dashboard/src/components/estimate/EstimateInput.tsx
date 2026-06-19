import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  buildTicketIndex,
  formatTicketContext,
  looksLikeTicketId,
  normalizeTicketId,
  searchServiceTypes,
  ServiceTypeSearchGroup,
  ticketFromRequest,
  TicketInfo,
} from '../../lib/estimateData';
import { ProcessedRequest } from '../../lib/dataProcessing';
import { trackEstimateClear, trackEstimateLookup, trackEstimateSearch, type EstimateSearchSource } from '../../lib/analytics';
import { WARD_ORDER } from '../../lib/constants';
import SingleSelect from '../shared/filters/SingleSelect';
import WardGuideCallout from './WardGuideCallout';

interface EstimateInputProps {
  serviceTypes: string[];
  categoryMap: Record<string, string>;
  wards: string[];
  rows: ProcessedRequest[];
  quickPicks?: string[];
  wardStandouts?: string[];
  replayToken?: number;
  showWardGuide?: boolean;
  selectedServiceType: string | null;
  selectedWard: string;
  ticket: TicketInfo | null;
  failedTicketId?: string | null;
  failedServiceType?: string | null;
  onServiceTypeSelected: (serviceType: string) => void;
  onTicketFound: (ticket: TicketInfo) => void;
  onTicketCleared: () => void;
  onClearAll: () => void;
  onWardChange: (ward: string) => void;
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-blue-100 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function flattenGroups(groups: ServiceTypeSearchGroup[]): string[] {
  const flat: string[] = [];
  for (const g of groups) {
    for (const t of g.types) flat.push(t);
  }
  return flat;
}

export default function EstimateInput({
  serviceTypes,
  categoryMap,
  wards,
  rows,
  quickPicks = [],
  wardStandouts = [],
  replayToken = 0,
  showWardGuide = false,
  selectedServiceType,
  selectedWard,
  ticket,
  failedTicketId = null,
  failedServiceType = null,
  onServiceTypeSelected,
  onTicketFound,
  onTicketCleared,
  onClearAll,
  onWardChange,
}: EstimateInputProps) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [browseAll, setBrowseAll] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wardAnchorRef = useRef<HTMLDivElement>(null);
  const [wardGuideActive, setWardGuideActive] = useState(false);

  useEffect(() => {
    if (showWardGuide) {
      setWardGuideActive(true);
    } else {
      setWardGuideActive(false);
    }
  }, [showWardGuide, selectedServiceType]);

  const ticketIndex = useMemo(() => buildTicketIndex(rows), [rows]);
  const isTicketMode = looksLikeTicketId(query);
  const dropdownQuery = browseAll && open ? '' : query;

  const searchGroups: ServiceTypeSearchGroup[] = useMemo(() => {
    if (isTicketMode) return [];
    return searchServiceTypes(dropdownQuery, serviceTypes, categoryMap);
  }, [dropdownQuery, serviceTypes, categoryMap, isTicketMode]);

  const flatItems = useMemo(() => flattenGroups(searchGroups), [searchGroups]);
  const totalResults = flatItems.length;

  useEffect(() => {
    setActiveIndex(-1);
  }, [query, browseAll]);

  useEffect(() => {
    if (failedTicketId && !ticket) {
      setQuery(failedTicketId);
      setNotFound(true);
      setOpen(false);
      return;
    }
    if (failedServiceType && !selectedServiceType && !ticket) {
      setQuery(failedServiceType);
      setOpen(false);
      return;
    }
    if (selectedServiceType && !ticket) {
      setQuery(selectedServiceType);
    }
    if (ticket) {
      setQuery(ticket.id);
    }
    if (!selectedServiceType && !ticket && !failedTicketId && !failedServiceType) {
      setQuery('');
      setNotFound(false);
      setBrowseAll(false);
      setOpen(false);
    }
  }, [selectedServiceType, ticket, failedTicketId, failedServiceType]);

  useEffect(() => {
    if (!replayToken) return;
    setBrowseAll(true);
    setOpen(true);
    inputRef.current?.focus();
  }, [replayToken]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const active = listRef.current.querySelector('[data-active="true"]');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const tryTicketLookup = useCallback((value: string) => {
    const normalized = normalizeTicketId(value);
    const match = ticketIndex.get(normalized) ?? ticketIndex.get(value.trim());
    if (match) {
      setNotFound(false);
      onTicketFound(ticketFromRequest(match));
      trackEstimateLookup(true);
      setOpen(false);
      return true;
    }
    trackEstimateLookup(false);
    setNotFound(true);
    return false;
  }, [ticketIndex, onTicketFound]);

  const handleSubmit = useCallback(() => {
    if (open && activeIndex >= 0 && activeIndex < flatItems.length) {
      const type = flatItems[activeIndex];
      setQuery(type);
      setNotFound(false);
      onTicketCleared();
      onServiceTypeSelected(type);
      trackEstimateSearch('typeahead', Boolean(selectedWard));
      setOpen(false);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) return;
    if (looksLikeTicketId(trimmed)) {
      tryTicketLookup(trimmed);
      return;
    }
    if (searchGroups.length === 1 && searchGroups[0].types.length === 1) {
      onTicketCleared();
      onServiceTypeSelected(searchGroups[0].types[0]);
      trackEstimateSearch('typeahead', Boolean(selectedWard));
      setOpen(false);
    }
  }, [query, searchGroups, flatItems, activeIndex, open, tryTicketLookup, onServiceTypeSelected, onTicketCleared, selectedWard]);

  const handleSelectType = (type: string, source: EstimateSearchSource) => {
    setQuery(type);
    setNotFound(false);
    setBrowseAll(false);
    onTicketCleared();
    onServiceTypeSelected(type);
    trackEstimateSearch(source, Boolean(selectedWard));
    setOpen(false);
  };

  const handleClear = useCallback(() => {
    setQuery('');
    setNotFound(false);
    setActiveIndex(-1);
    setBrowseAll(true);
    setOpen(true);
    trackEstimateClear('input');
    if (ticket) onTicketCleared();
    inputRef.current?.focus();
  }, [ticket, onTicketCleared]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && flatItems.length > 0) {
        setBrowseAll(!query.trim() || query === selectedServiceType);
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((prev) => (prev < flatItems.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }, [open, flatItems.length, handleSubmit, query, selectedServiceType]);

  const wardOptions = useMemo(
    () => [
      { label: 'Any ward (citywide)', value: '' },
      ...WARD_ORDER.filter((w: string) => wards.includes(w)).map((w: string) => ({ label: w, value: w })),
    ],
    [wards],
  );

  const activeDescendant = activeIndex >= 0 && activeIndex < flatItems.length
    ? `${listId}-opt-${activeIndex}`
    : undefined;

  const showDropdown = open && searchGroups.length > 0;
  const hasQuery = query.trim().length > 0;
  const showWardStandouts = wardStandouts.length > 0
    && selectedWard
    && !selectedServiceType
    && !ticket
    && !query.trim();

  return (
    <div className="bg-surface border border-border rounded-lg mb-2">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <p className="text-body font-medium text-gray-900 mb-0">How long will your 311 request take?</p>
        {(selectedServiceType || ticket) && (
          <button
            type="button"
            onClick={onClearAll}
            className="text-caption text-text-muted hover:text-gray-900 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <div className="font-mono px-4 py-3">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-3">
          <div ref={containerRef} className="relative">
            <label htmlFor="estimate-query" className="sr-only">
              Ticket # or service type
            </label>
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                id="estimate-query"
                type="text"
                role="combobox"
                aria-expanded={showDropdown}
                aria-controls={listId}
                aria-activedescendant={activeDescendant}
                autoComplete="off"
                placeholder="Search by service type or paste a ticket #"
                className="w-full text-body border border-border rounded-md pl-9 pr-8 py-2 min-h-[44px] bg-surface focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors"
                value={query}
                onChange={(e) => {
                  const next = e.target.value;
                  setQuery(next);
                  setNotFound(false);
                  setBrowseAll(false);
                  if (ticket) onTicketCleared();
                  setOpen(!looksLikeTicketId(next));
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  if (looksLikeTicketId(query)) return;
                  setBrowseAll(!query.trim() || query === selectedServiceType);
                  setOpen(true);
                }}
              />
              {hasQuery && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-text-muted hover:text-gray-900 hover:bg-surface-muted transition-colors"
                  aria-label="Clear search"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
            {isTicketMode && hasQuery && !notFound && !ticket && (
              <p className="mt-1.5 text-caption text-blue-700 mb-0 flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 0 0-2 2v3a2 2 0 1 1 0 4v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 1 1 0-4V7a2 2 0 0 0-2-2H5z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Ticket ID detected — press Enter to look it up
              </p>
            )}
            {showDropdown && (
              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-surface border border-border rounded-md shadow-lg scrollbar-thin"
              >
                <li className="px-3 py-1.5 text-caption text-text-muted border-b border-border bg-surface" aria-hidden="true">
                  {browseAll && !dropdownQuery.trim()
                    ? `${totalResults} service types`
                    : `${totalResults} result${totalResults !== 1 ? 's' : ''}`}
                </li>
                {searchGroups.map((group) => {
                  return (
                    <li key={group.category} role="group" aria-label={group.category}>
                      <div className="px-3 py-1.5 text-caption font-semibold text-text-muted bg-surface-muted flex items-center justify-between">
                        <span>{group.category}</span>
                        <span className="text-caption tabular-nums font-normal">{group.types.length}</span>
                      </div>
                      <ul role="presentation">
                        {group.types.map((type) => {
                          const flatIdx = flatItems.indexOf(type);
                          const isActive = flatIdx === activeIndex;
                          return (
                            <li key={type}>
                              <button
                                id={`${listId}-opt-${flatIdx}`}
                                type="button"
                                role="option"
                                aria-selected={isActive}
                                data-active={isActive}
                                className={`w-full text-left px-3 py-2 text-body min-h-[44px] transition-colors ${
                                  isActive
                                    ? 'bg-blue-50 text-blue-900'
                                    : 'hover:bg-surface-muted'
                                }`}
                                onClick={() => handleSelectType(type, 'typeahead')}
                                onMouseEnter={() => setActiveIndex(flatIdx)}
                              >
                                <HighlightMatch text={type} query={dropdownQuery.trim()} />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}
            {notFound && looksLikeTicketId(query) && (
              <p className="mt-1.5 text-caption text-amber-800 mb-0">
                Ticket not found — it may be older than one year. Try searching by service type instead.
              </p>
            )}
          </div>
          <div
            ref={wardAnchorRef}
            className={`relative${wardGuideActive ? ' rounded-md ring-2 ring-blue-400 ring-offset-2 transition-shadow duration-300' : ''}`}
          >
            <WardGuideCallout
              key={selectedServiceType ?? 'none'}
              show={showWardGuide}
              anchorRef={wardAnchorRef}
              onDismiss={() => setWardGuideActive(false)}
            />
            <SingleSelect
              label=""
              ariaLabel="Ward"
              value={selectedWard}
              options={wardOptions}
              onChange={onWardChange}
              describedBy={wardGuideActive ? 'estimate-ward-guide' : undefined}
            />
          </div>
        </div>
        {showWardStandouts && (
          <div className="mt-3">
            <p className="text-caption font-semibold text-text-muted mb-1.5">
              Slowest in {selectedWard} vs. citywide
            </p>
            <div className="flex flex-wrap gap-2">
              {wardStandouts.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleSelectType(type, 'ward_standout')}
                  className="text-caption px-2.5 py-1 min-h-[32px] rounded-full border border-border bg-surface-muted hover:bg-blue-50 hover:border-blue-200 hover:text-blue-900 text-gray-800 transition-colors"
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}
        {quickPicks.length > 0 && !selectedServiceType && !ticket && !showWardStandouts && (
          <div className="mt-3">
            <p className="text-caption font-semibold text-text-muted mb-1.5">Popular requests</p>
            <div className="flex flex-wrap gap-2">
              {quickPicks.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleSelectType(type, 'quick_pick')}
                  className="text-caption px-2.5 py-1 min-h-[32px] rounded-full border border-border bg-surface-muted hover:bg-blue-50 hover:border-blue-200 hover:text-blue-900 text-gray-800 transition-colors"
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}
        {ticket && (
          <div className="sla-month-detail-compact mt-3">
            <p className="sla-month-detail-compact-text mb-0">{formatTicketContext(ticket)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
