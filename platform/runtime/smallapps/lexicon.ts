/**
 * The small-app word tables: how the planner reads a line, and (with the menu) the only words a
 * small app's title and labels may use. Pure data. None of these words states a quantity.
 */
import type { Preset } from './descriptor.ts';

export const OPERATIONS: [string, string[]][] = [
  ['net_sales', ['net sales', 'net bikri', 'shuddh bikri']],
  ['margin', ['contribution margin', 'margin', 'profit', 'profits', 'munafa', 'munafaa', 'fayda', 'faayda', 'मुनाफा']],
  ['aging', ['receivable aging', 'aging', 'ageing', 'overdue', 'dues', 'outstanding', 'receivables', 'udhaar', 'udhar', 'baaki', 'baki', 'bakaya', 'उधार', 'बकाया']],
  ['billed', ['billed', 'billing', 'invoiced', 'invoices', 'bills', 'bill kiya', 'बिल']],
  ['received', ['received', 'collections', 'collection', 'collected', 'payments', 'paisa aaya', 'vasooli', 'vasuli', 'jama', 'वसूली']],
  ['refunds', ['refunds', 'refund', 'returns', 'wapas', 'vapas', 'vaapsi', 'वापसी']],
  ['purchases', ['purchases', 'purchase', 'kharid', 'khareed', 'kharidari', 'खरीद']],
  ['costs', ['costs', 'cost', 'expenses', 'expense', 'kharcha', 'kharch', 'lagat', 'खर्च']],
  ['revenue', ['sales', 'revenue', 'earned', 'bikri', 'becha', 'kamai', 'बिक्री']],
];
/**
 * Action words, English, romanised Hindi and Devanagari, folded to one concept each. Catalogue rows are
 * read through the same table: a row's concepts are the folded words of its label and operation id,
 * so any catalogue action can be named without a rule written for it.
 */
export const CONCEPTS: [string, string[]][] = [
  ['reminder', ['reminder', 'reminders', 'remind', 'yaad', 'tagada', 'tagaada', 'takaza', 'takaaza', 'याद', 'तकाजा', 'तगादा']],
  ['invoice', ['invoice', 'invoices', 'bill', 'bills', 'challan', 'बिल', 'चालान']],
  ['payment', ['payment', 'payments', 'pay', 'bhugtan', 'bhugtaan', 'paisa', 'भुगतान']],
  ['link', ['link', 'links', 'लिंक']],
  ['refund', ['refund', 'refunds', 'wapas', 'vapas', 'vaapsi', 'वापसी']],
  ['message', ['message', 'messages', 'msg', 'sandesh', 'sandesa', 'संदेश']],
  ['whatsapp', ['whatsapp', 'watsapp', 'वॉट्सऐप', 'व्हाट्सएप']],
  ['email', ['email', 'emails', 'mail', 'ईमेल']],
  ['send', ['send', 'bhejo', 'bhejna', 'bhej', 'भेजो', 'भेजें']],
  ['price', ['price', 'prices', 'pricing', 'daam', 'dam', 'keemat', 'kimat', 'rate', 'दाम', 'कीमत']],
  ['stock', ['stock', 'inventory', 'maal', 'स्टॉक']],
  ['delete', ['delete', 'remove', 'hatao', 'mitao', 'हटाओ']],
  ['contact', ['contact', 'contacts', 'sampark', 'संपर्क']],
  ['calendar', ['calendar', 'event', 'events', 'meeting', 'कैलेंडर']],
  ['sheet', ['sheet', 'sheets', 'spreadsheet', 'शीट']],
  ['draft', ['draft', 'drafts', 'masauda', 'मसौदा']],
  ['record', ['record', 'records', 'darj', 'दर्ज']],
  ['ledger', ['ledger', 'khata', 'खाता']],
];
/** Period phrases, read as whole phrases only. */
export const PERIODS: [Preset, string[]][] = [
  ['this-month', ['this month', 'is mahine', 'iss mahine', 'is mahina', 'current month']],
  ['last-month', ['last month', 'previous month', 'pichhle mahine', 'pichle mahine', 'pichhla mahina', 'pichla mahina']],
  ['today', ['today', 'aaj']],
  ['yesterday', ['yesterday']],
  ['last-7-days', ['this week', 'last week', 'is hafte', 'iss hafte', 'pichhle hafte', 'pichle hafte']],
  ['this-quarter', ['this quarter', 'is quarter', 'is timahi']],
  ['last-quarter', ['last quarter', 'previous quarter', 'pichhle quarter', 'pichle quarter']],
  ['this-financial-year', ['this financial year', 'this year', 'is saal', 'iss saal', 'is varsh']],
  ['last-financial-year', ['last financial year', 'last year', 'pichhle saal', 'pichle saal']],
  ['all-time', ['all time', 'ever', 'ab tak', 'shuru se']],
];
export const FOLLOW_UP = ['follow up', 'follow ups', 'followup', 'followups', 'call list', 'who to call', 'calls to make', 'call karna', 'phone karna', 'फॉलो'];
/**
 * Joining words a title or label may add to menu words. Kept deliberately small: nothing here can
 * state an amount, a share, a multiple, an order or a direction ("a", "by", "is", "up", "down" are
 * left out so "fell by a fifth" or "is nil" cannot be assembled from allowed words).
 */
export const CONNECTIVES = ['and', 'or', 'for', 'of', 'in', 'against', 'versus', 'vs', 'with', 'my', 'our', 'the', 'this', 'figures', 'actions', 'action', 'book',
  'prepare', 'small', 'app', 'records', 'calls', 'shop', 'summary', 'overview', 'ka', 'ki', 'ke', 'aur', 'se', 'mein', 'का', 'की', 'के', 'और', 'से', 'में'];
