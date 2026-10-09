export const adminModules = [
  { id: 'home', name: 'Home', route: '/', description: 'Status across your application.' },
  {
    id: 'notifications',
    name: 'Notifications',
    route: '/notifications',
    description: 'Delivery, destinations and local API access.',
  },
  {
    id: 'workout',
    name: 'Workout',
    route: '/workout',
    description: 'Plan, log and review training.',
    pages: [
      'Overview',
      'Programs',
      'Exercises',
      'History',
      'Progression',
      'Active',
      'Settings',
    ].map((name) => ({
      name,
      route: name === 'Overview' ? '/workout' : '/workout/' + name.toLowerCase(),
    })),
  },
  { id: 'kingshot', name: 'Kingshot', route: '/kingshot', description: 'Planned integration.' },
  {
    id: 'commands',
    name: 'Commands',
    route: '/commands',
    description: 'Command library, responses and moderator permissions.',
  },
  {
    id: 'custom-command',
    name: 'CustomCommand',
    route: '/custom-command',
    description: 'Trusted local execution and developer authentication.',
  },
  { id: 'logs', name: 'Logs', route: '/logs', description: 'Recent application events.' },
  {
    id: 'settings',
    name: 'Settings',
    route: '/settings',
    description: 'Global Discord connection and application configuration.',
  },
];
