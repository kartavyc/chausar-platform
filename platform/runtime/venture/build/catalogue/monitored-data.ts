// Original source-service capability catalogue. Unqualified provider effects stay planned.
import type {CatalogueEntry} from '../catalogue.ts';
export const MONITORED_DATA_CATALOGUE:readonly CatalogueEntry[]=Object.freeze([
  {
    "id": "page-monitors",
    "name": "Permitted public page monitoring",
    "category": "docs-ops",
    "auth": "Owner approves the source terms and exact elements",
    "regions": [
      "india",
      "global"
    ],
    "regionNote": null,
    "note": "Reads static public pages with robots and network guards. Recurring reads need separate owner approval.",
    "vendorUrl": null,
    "targets": [
      "read"
    ]
  },
  {
    "id": "source-export",
    "name": "Observed source spreadsheet",
    "category": "docs-ops",
    "auth": "Owner-reviewed source values",
    "regions": [
      "india",
      "global"
    ],
    "regionNote": null,
    "note": "Download exact observed values and code receipts as CSV or XLSX. The owner shares the file.",
    "vendorUrl": null,
    "targets": [
      "handoff"
    ]
  }
]);
