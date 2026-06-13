/** Site copy and external links for portfolio shell. */

export const SITE_TITLE = '311: DC\u2019s To-Do List';

export const SITE_DESCRIPTION =
  'DC 311 SLA compliance broken down by category, ward, and service type. ~465,000 requests over twelve months.';

export const GITHUB_REPO_URL = import.meta.env.VITE_GITHUB_REPO_URL ?? '';

export const AUTHOR_NAME = import.meta.env.VITE_AUTHOR_NAME ?? 'Darrell Henderson';

export const GITHUB_PROFILE_URL = import.meta.env.VITE_GITHUB_PROFILE_URL ?? 'https://github.com/darrellhenderson';

export const LINKEDIN_URL = import.meta.env.VITE_LINKEDIN_URL ?? 'https://www.linkedin.com/in/darrell-henderson/';

export const AUTHOR_BIO =
  'Reliability engineer applying cloud infrastructure thinking to civic systems.';

export const TAB_CONFIG = [
  { id: 'overview' as const, label: 'Overview', subtitle: 'The big picture' },
  { id: 'sla' as const, label: 'Performance', subtitle: 'By category and service type' },
  { id: 'explorer' as const, label: 'Explore', subtitle: 'Ward, timing, and volume' },
  { id: 'raw' as const, label: 'Records', subtitle: 'The raw data' },
];
