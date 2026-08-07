import {
  BarChart3,
  BellRing,
  PackageSearch,
  CalendarDays,
  CalendarSearch,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  ClockAlert,
  ExternalLink,
  LayoutDashboard,
  LockKeyhole,
  PackageCheck,
  ReceiptText,
  Settings2,
  Wrench,
  Receipt,
  Gem,
  Shirt,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

export type NavigationItem = {
  to: string;
  label: string;
  /** Compact label used where space is tight (mobile bottom bar). */
  shortLabel?: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Shown directly in the mobile bottom bar: the four actions that matter most on a phone. */
  mobileQuick?: boolean;
};

export type NavigationGroup = {
  label: string;
  items: readonly NavigationItem[];
};

/**
 * The single source of truth for every destination in the app.
 *
 * One flat list of twenty items made the sidebar a wall of links: nothing said
 * which screen belongs to which part of the day. Grouping keeps every shell
 * (desktop sidebar, mobile bottom bar, mobile "more" sheet) consistent, because
 * they all render from this one structure.
 */
export const navigationGroups: readonly NavigationGroup[] = [
  {
    label: 'الرئيسية',
    items: [
      { to: '/', label: 'لوحة التحكم', shortLabel: 'الرئيسية', icon: LayoutDashboard, mobileQuick: true },
    ],
  },
  {
    label: 'المخزون والخدمة',
    items: [
      { to: '/inventory', label: 'المخزون', icon: Shirt },
      { to: '/accessories', label: 'الملحقات', icon: Gem },
      { to: '/availability', label: 'المتاح في فترة', icon: CalendarSearch },
      { to: '/service', label: 'طابور الخدمة', icon: Wrench },
      { to: '/stocktake', label: 'الجرد الدوري', icon: ClipboardCheck },
      { to: '/inventory-performance', label: 'أداء المخزون', icon: PackageSearch },
    ],
  },
  {
    label: 'العملاء والحجوزات',
    items: [
      { to: '/customers', label: 'العملاء', icon: UsersRound },
      { to: '/reservations', label: 'الحجوزات', shortLabel: 'حجوزات', icon: CalendarDays, mobileQuick: true },
      { to: '/appointments', label: 'المواعيد', icon: Clock3 },
      { to: '/waitlist', label: 'قائمة الانتظار', icon: ClockAlert },
      { to: '/reminders', label: 'التذكيرات', icon: BellRing },
    ],
  },
  {
    label: 'المبيعات والمالية',
    items: [
      { to: '/delivery-return', label: 'التسليم والاسترجاع', shortLabel: 'تسليم', icon: PackageCheck, mobileQuick: true },
      { to: '/sales', label: 'المبيعات والمرتجعات', icon: Receipt },
      { to: '/payments', label: 'المدفوعات', shortLabel: 'مدفوعات', icon: WalletCards, mobileQuick: true },
      { to: '/expenses', label: 'المصروفات', icon: ReceiptText },
      { to: '/daily-closing', label: 'إقفال اليومية', icon: LockKeyhole },
    ],
  },
  {
    label: 'التقارير والإدارة',
    items: [
      { to: '/reports', label: 'التقارير', icon: BarChart3 },
      { to: '/audit-log', label: 'سجل التدقيق', icon: ClipboardList },
      { to: '/preferences', label: 'الإعدادات والنسخ', icon: Settings2, adminOnly: true },
    ],
  },
];

/** Flat list kept for compatibility; `navigationGroups` is the source of truth. */
export const navigation: readonly NavigationItem[] = navigationGroups.flatMap((group) => group.items);

/** The four actions that matter most while standing at the till with a phone. */
export const mobileQuickNavigation: readonly NavigationItem[] = navigation.filter((item) => item.mobileQuick);

/** The public catalogue every customer sees — reachable from the app for a quick preview. */
export const publicPageLink = { to: '/landing', label: 'الصفحة العامة للمعرض', icon: ExternalLink } as const;

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2';
