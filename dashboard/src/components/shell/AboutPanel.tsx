import { useEffect, useRef } from 'react';
import {
  AUTHOR_BIO,
  AUTHOR_NAME,
  GITHUB_PROFILE_URL,
  GITHUB_REPO_URL,
  LINKEDIN_URL,
} from '../../lib/site';
import { OutboundLink, trackOutboundClick } from '../../lib/analytics';

const DC311_DATA_URL =
  'https://opendata.dc.gov/datasets/DCGIS::all-311-city-service-requests-last-30-days/about';
const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';

const GH_PATH = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z";
const LI_PATH = "M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
      {children}
    </p>
  );
}

function PillLink({
  href,
  icon,
  children,
  linkId,
}: {
  href: string;
  icon: string;
  children: React.ReactNode;
  linkId: OutboundLink;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 text-sm text-gray-700 hover:border-gray-400 hover:text-gray-900 transition-colors"
      onClick={() => trackOutboundClick(linkId)}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
        <path d={icon} />
      </svg>
      {children}
    </a>
  );
}

interface AboutPanelProps {
  open: boolean;
  builtAt: string | null;
  onClose: () => void;
}

export default function AboutPanel({ open, builtAt, onClose }: AboutPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-surface rounded-xl shadow-xl max-w-lg w-full flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-4rem)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 shrink-0 border-b border-gray-100">
          <h2 id="about-title" className="text-base font-semibold text-gray-900 tracking-tight">
            Notes
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-6 py-5 space-y-6 text-sm text-gray-600 leading-relaxed">

          {/* About */}
          <div>
            <SectionLabel>About</SectionLabel>
            <p>
              DC publishes every 311 service request as open data, including the deadline the city
              assigns when a ticket is filed. This project measures how often the city meets those
              deadlines across ~465,000 requests, broken down by category, service type, and ward.
            </p>
          </div>

          <hr className="border-gray-100" />

          {/* Data source */}
          <div>
            <SectionLabel>Data source</SectionLabel>
            <p className="mb-2">
              DC Open Data 311 service requests via ArcGIS.
              {builtAt && <span className="text-gray-400"> Snapshot built {builtAt}.</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              <PillLink href={DC311_DATA_URL} linkId="source_data" icon="M9.5 0a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H8v1h5.5A1.5 1.5 0 0 1 15 4.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-9A1.5 1.5 0 0 1 2.5 3H8V2H6.5a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-1 6.5a.5.5 0 0 0-1 0v3.793L6.146 8.94a.5.5 0 1 0-.707.707l2.5 2.5a.5.5 0 0 0 .707 0l2.5-2.5a.5.5 0 0 0-.707-.707L9.5 10.293V6.5z">
                DC Open Data
              </PillLink>
              <PillLink href={CC_BY_URL} linkId="cc_by" icon="M4.475 5.458c-.284 0-.514.237-.47.517C4.28 7.575 5.806 9 8 9c2.193 0 3.792-1.425 3.994-3.025.044-.28-.186-.517-.47-.517H4.475zm4.151 1.844c-.184 1.043-.98 1.76-2.89 1.76-.908 0-1.727-.343-2.25-.873a2.5 2.5 0 0 1 0-3.554c.523-.53 1.342-.873 2.25-.873 1.91 0 2.706.717 2.89 1.76H4.475a.5.5 0 0 0 0 1h4.151zM8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm0 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1z">
                CC BY 4.0
              </PillLink>
            </div>
            <p className="mt-2 text-gray-400 text-xs">
              Data has been filtered, categorized, and aggregated for this analysis.
            </p>
          </div>

          <hr className="border-gray-100" />

          {/* How it works */}
          <div>
            <SectionLabel>How it works</SectionLabel>
            <p className="mb-3">
              A Python pipeline pulls from DC's ArcGIS endpoint, groups requests into categories,
              and builds compact JSON shards with pre-aggregated rollups. The browser loads shards
              on demand and runs all analytics client-side: React, TypeScript, Plotly. No backend,
              no database. Static files on GitHub Pages.
            </p>
            {GITHUB_REPO_URL && (
              <PillLink href={GITHUB_REPO_URL} linkId="github_repo" icon={GH_PATH}>
                View source
              </PillLink>
            )}
          </div>

          <hr className="border-gray-100" />

          {/* Built by */}
          <div>
            <SectionLabel>Built by</SectionLabel>
            <div className="flex items-center gap-4 p-4 rounded-lg bg-gray-50 mb-3">
              {GITHUB_PROFILE_URL && (
                <img
                  src={`${GITHUB_PROFILE_URL}.png?size=80`}
                  alt={AUTHOR_NAME}
                  width={52}
                  height={52}
                  className="rounded-full shrink-0 ring-2 ring-white"
                />
              )}
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 text-sm leading-tight">{AUTHOR_NAME}</p>
                <p className="text-gray-500 text-xs mt-0.5 leading-snug">{AUTHOR_BIO}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {GITHUB_PROFILE_URL && (
                <PillLink href={GITHUB_PROFILE_URL} linkId="github_profile" icon={GH_PATH}>
                  GitHub
                </PillLink>
              )}
              {LINKEDIN_URL && (
                <PillLink href={LINKEDIN_URL} linkId="linkedin" icon={LI_PATH}>
                  LinkedIn
                </PillLink>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
