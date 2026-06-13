import { GITHUB_REPO_URL } from '../../lib/site';

const DC311_DATA_URL =
  'https://opendata.dc.gov/datasets/DCGIS::all-311-city-service-requests-last-30-days/about';
const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';

function GitHubIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

interface AppFooterProps {
  onAboutClick: () => void;
}

export default function AppFooter({ onAboutClick }: AppFooterProps) {
  const repoHref = GITHUB_REPO_URL || '#';

  return (
    <footer className="bg-gradient-to-b from-neutral-900 to-neutral-950 border-t border-neutral-800 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-col sm:flex-row items-center justify-between gap-1">
        <p className="text-caption text-neutral-500 text-center sm:text-left">
          Data:{' '}
          <a
            href={DC311_DATA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-neutral-300 underline-offset-2 hover:underline"
          >
            DC Open Data 311 Service Requests
          </a>
          {' '}© District of Columbia,{' '}
          <a
            href={CC_BY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-neutral-300 underline-offset-2 hover:underline"
          >
            CC BY 4.0
          </a>
        </p>
        <div className="flex items-center gap-3">
          <a
            href={repoHref}
            target={GITHUB_REPO_URL ? '_blank' : undefined}
            rel="noopener noreferrer"
            className="text-neutral-500 hover:text-neutral-100 transition-colors"
            aria-label="View source on GitHub"
          >
            <GitHubIcon />
          </a>
          <button
            type="button"
            onClick={onAboutClick}
            className="text-caption text-neutral-400 hover:text-neutral-100 underline-offset-2 hover:underline px-1"
          >
            Notes
          </button>
        </div>
      </div>
    </footer>
  );
}
