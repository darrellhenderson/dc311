import { TAB_CONFIG } from '../../lib/site';

type TabId = (typeof TAB_CONFIG)[number]['id'];

interface TabNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export default function TabNav({ activeTab, onTabChange }: TabNavProps) {
  return (
    <nav className="sticky top-0 z-30 bg-surface border-b border-border" aria-label="Dashboard views">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 md:flex md:space-x-1" role="tablist">
          {TAB_CONFIG.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onTabChange(tab.id)}
                className={`min-h-[44px] px-2 md:px-4 py-2.5 text-center md:text-left border-b-2 transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-text-muted hover:text-gray-900'
                }`}
              >
                <span className="text-body font-medium block">{tab.label}</span>
                <span className="hidden md:block text-caption opacity-75">{tab.subtitle}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
