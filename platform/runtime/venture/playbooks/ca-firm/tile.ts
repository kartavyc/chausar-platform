// Chausar flagship playbook, AI-native CA firm: its Start gallery tile (Ink v2 wave 5, package 5A1; plan 5C "Gallery
// tile"). The hours and pay are a model estimate, shown so with their basis (playbooks/ways.ts WAY_SOURCE). The team
// names the playbook's own roles, at most four: the reconciler keeps the books, the tax preparer works the returns, and
// two code roles (the calculator and the checks) that are never drawn as an AI. The Hindi is machine-drafted and needs
// a native reviewer (HINDI_REVIEW, playbooks/ways.ts). Written for Chausar; nothing here is learned from an outside
// source.
import type { StartTile } from '../kit/define.ts';

export const CA_FIRM_TILE: StartTile = Object.freeze({
  category: 'money-and-tax',
  icon: 'calculator',
  line: 'Books, GST, TDS and income tax working papers for small businesses; your CA of record signs anything regulated.',
  youDo: Object.freeze({ hoursMin: 6, hoursMax: 10, line: 'Meet clients, review drafts, work with your CA.' }),
  team: Object.freeze({ roleIds: Object.freeze(['reconciler', 'preparer', 'calculator', 'checker']), line: 'Books, workings, receipts for every figure.' }),
  pay: Object.freeze({ minRupees: 5000, maxRupees: 20000, per: 'a client a month' }),
});

/** The tile's lines in Hindi (machine-drafted, needs a native reviewer). */
export const CA_FIRM_TILE_HI = Object.freeze({
  line: 'छोटे बिज़नेस के लिए बही-खाते, GST, TDS और इनकम टैक्स के वर्किंग पेपर्स; जो भी काम नियमों के तहत है, उस पर आपके CA दस्तख़त करते हैं।',
  youDo: 'क्लाइंट से मिलें, ड्राफ़्ट जाँचें, अपने CA के साथ काम करें।',
  teamLine: 'बही-खाते, वर्किंग और हर आँकड़े की रसीद।',
});
