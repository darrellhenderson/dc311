import { useEffect, useRef } from 'react';
import { TAB_CONFIG, TabId } from '../../lib/site';

export const TAB_NAV_HEIGHT_VAR = '--dashboard-tab-nav-height';

interface TabNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export default function TabNav({ activeTab, onTabChange }: TabNavProps) {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = navRef.current;
    if (!node) return undefined;

    const syncHeight = () => {
      document.documentElement.style.setProperty(TAB_NAV_HEIGHT_VAR, `${node.offsetHeight}px`);
    };

    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(TAB_NAV_HEIGHT_VAR);
    };
  }, []);

  return (
    <nav
      ref={navRef}
      className="sticky top-0 z-30 bg-surface border-b border-border"
      aria-label="Dashboard views"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div
          className="flex gap-0.5 sm:gap-1 overflow-x-auto scrollbar-thin -mx-4 px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0"
          role="tablist"
        >
          {TAB_CONFIG.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onTabChange(tab.id)}
                className={`shrink-0 min-h-[44px] px-2 sm:px-3 md:px-4 py-2.5 whitespace-nowrap text-center md:text-left text-body font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-text-muted hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
