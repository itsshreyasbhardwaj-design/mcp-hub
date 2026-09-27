export interface NavItem {
  href: string;
  label: string;
  /** Lucide icon name, resolved in the client sidebar. */
  icon: string;
  /** Shown in the sidebar tooltip and the command palette. */
  description: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    label: 'Registry',
    items: [
      { href: '/', label: 'Overview', icon: 'LayoutDashboard', description: 'Fleet health and usage at a glance' },
      { href: '/servers', label: 'Servers', icon: 'Server', description: 'Every registered MCP server' },
      { href: '/discover', label: 'Discover', icon: 'Search', description: 'Search servers, tools, resources and prompts' },
      { href: '/tools', label: 'Tools', icon: 'Wrench', description: 'Every tool, independent of its server' },
    ],
  },
  {
    label: 'Operate',
    items: [
      { href: '/testing', label: 'Testing', icon: 'FlaskConical', description: 'Validation and compatibility runs' },
      { href: '/monitoring', label: 'Monitoring', icon: 'Activity', description: 'Health checks, uptime and incidents' },
      { href: '/versions', label: 'Versions', icon: 'GitCompareArrows', description: 'Publish and compare versions' },
    ],
  },
  {
    label: 'Govern',
    items: [
      { href: '/security', label: 'Security', icon: 'ShieldAlert', description: 'Permissions, approvals and findings' },
      { href: '/analytics', label: 'Analytics', icon: 'ChartLine', description: 'Usage derived from recorded events' },
      { href: '/activity', label: 'Activity', icon: 'ScrollText', description: 'The audit log' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/team', label: 'Team', icon: 'Users', description: 'Members, roles and teams' },
      { href: '/settings', label: 'Settings', icon: 'Settings', description: 'Organization and deployment settings' },
      { href: '/api', label: 'API', icon: 'KeyRound', description: 'API keys, SDK and MCP integration' },
    ],
  },
];

export const ALL_NAV_ITEMS = NAVIGATION.flatMap((section) => section.items);
