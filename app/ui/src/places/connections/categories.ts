import type { IconName } from '../../parts/icons';

/** Each catalogue category's icon (platform/runtime/venture/build/catalogue.ts CATEGORY_LABELS), from the allowlist. */
const CATEGORY_ICONS: Readonly<Record<string, IconName>> = {
  build: 'wrench',
  'site-domain': 'layout-grid',
  payments: 'wallet',
  email: 'send',
  booking: 'calendar',
  customers: 'contact',
  messaging: 'messages-square',
  'docs-ops': 'file-text',
  marketing: 'megaphone',
  'books-tax': 'receipt-text',
  'legal-entity': 'stamp',
  analytics: 'trending-up',
};

/** A category the engine adds later still gets an icon: the plug. */
export const categoryIcon = (category: string): IconName => CATEGORY_ICONS[category] ?? 'plug';
