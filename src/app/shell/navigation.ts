import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Clock3,
  LayoutDashboard,
  LockKeyhole,
  PackageCheck,
  ReceiptText,
  Settings2,
  Wrench,
  Receipt,
  Shirt,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';

export type NavigationItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

export const navigation: readonly NavigationItem[] = [
  { to: '/', label: 'لوحة التحكم', icon: LayoutDashboard },
  { to: '/inventory', label: 'المخزون', icon: Shirt },
  { to: '/customers', label: 'العملاء', icon: UsersRound },
  { to: '/reservations', label: 'الحجوزات', icon: CalendarDays },
  { to: '/appointments', label: 'المواعيد', icon: Clock3 },
  { to: '/delivery-return', label: 'التسليم والاسترجاع', icon: PackageCheck },
  { to: '/sales', label: 'المبيعات والمرتجعات', icon: Receipt },
  { to: '/service', label: 'طابور الخدمة', icon: Wrench },
  { to: '/payments', label: 'المدفوعات', icon: WalletCards },
  { to: '/expenses', label: 'المصروفات', icon: ReceiptText },
  { to: '/daily-closing', label: 'إقفال اليومية', icon: LockKeyhole },
  { to: '/audit-log', label: 'سجل التدقيق', icon: ClipboardList },
  { to: '/reports', label: 'التقارير', icon: BarChart3 },
  { to: '/preferences', label: 'الإعدادات والنسخ', icon: Settings2 },
];

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2';
