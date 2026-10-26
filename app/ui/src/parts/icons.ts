/**
 * The icons Ink may draw, by their Lucide names (D-STYLE.md section 5, plus the five the boards also use). The
 * `Icon` part takes only these names, so the set stays small and reviewed. A W4 package that needs another adds one
 * line here and one in tests/parts/icon-logo-avatar.test.tsx.
 *
 * lucide-react is ISC licensed and pinned to an exact version in the root package.json.
 */

import {
  ArrowLeftRight, ArrowRight, Bell, Bot, Briefcase, Calendar, Check, ChevronDown, ChevronRight, ChevronsUpDown,
  CircleHelp, Clock, Contact, Eye, EyeOff, FilePen, FileText, Handshake, History, IndianRupee, LayoutGrid, Lock,
  Megaphone, MessageSquare, MessagesSquare, Mic, Package, Paperclip, Pencil, Play, Plug, Plus, ReceiptText, RotateCcw,
  Scissors, Search, Send, ShieldCheck, SlidersHorizontal, Sparkles, SquarePlay, Stamp, Sun, Tag, Target, TrendingUp,
  TriangleAlert, Upload, Users, Wallet, Wrench, X, type LucideIcon,
} from 'lucide-react';

export const ICONS = {
  // The rail.
  sun: Sun,
  'messages-square': MessagesSquare,
  users: Users,
  briefcase: Briefcase,
  contact: Contact,
  wallet: Wallet,
  plug: Plug,
  // Everything else in D-STYLE.md section 5.
  'chevrons-up-down': ChevronsUpDown,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'arrow-right': ArrowRight,
  bell: Bell,
  sparkles: Sparkles,
  target: Target,
  calendar: Calendar,
  pencil: Pencil,
  'trending-up': TrendingUp,
  'receipt-text': ReceiptText,
  check: Check,
  x: X,
  lock: Lock,
  eye: Eye,
  'eye-off': EyeOff,
  history: History,
  'rotate-ccw': RotateCcw,
  'triangle-alert': TriangleAlert,
  'circle-help': CircleHelp,
  clock: Clock,
  tag: Tag,
  stamp: Stamp,
  send: Send,
  'file-text': FileText,
  'file-pen': FilePen,
  bot: Bot,
  play: Play,
  plus: Plus,
  'message-square': MessageSquare,
  'layout-grid': LayoutGrid,
  mic: Mic,
  'arrow-left-right': ArrowLeftRight,
  scissors: Scissors,
  // lucide-react 1.x ships no brand icons. A YouTube mark is drawn as the plain square-play.
  youtube: SquarePlay,
  // Departments.
  handshake: Handshake,
  megaphone: Megaphone,
  package: Package,
  'indian-rupee': IndianRupee,
  wrench: Wrench,
  // Also on the boards: posture, uploads, search, filters, attachments.
  'shield-check': ShieldCheck,
  upload: Upload,
  search: Search,
  'sliders-horizontal': SlidersHorizontal,
  paperclip: Paperclip,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/**
 * The five departments of spec 3 ("Team"), in the order the toggle lists them. The ids are the D class suffixes
 * (`d-prod`, `p-prod`) and the token prefixes (`--prod`, `--prod-tint`, `--prod-line`).
 */
export const DEPT_IDS = ['sales', 'mkt', 'prod', 'money', 'ops'] as const;
export type DeptId = (typeof DEPT_IDS)[number];

/** Each department's icon (D-STYLE.md section 3). */
export const DEPT_ICONS: Readonly<Record<DeptId, IconName>> = {
  sales: 'handshake',
  mkt: 'megaphone',
  prod: 'package',
  money: 'indian-rupee',
  ops: 'wrench',
};
