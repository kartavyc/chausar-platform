// Browser fixture of the confirmed rule register. Engine parity is tested.
export const FAKE_CA_RULES = {
  "version": 1,
  "confirmedBy": null,
  "rules": [
    {
      "assessmentYear": "2026-27",
      "validFrom": "2026-04-01",
      "validTo": "2027-03-31",
      "verification": "Official AY 2026-27 instructions checked on 27 October 2026.",
      "id": "itr-2026-27",
      "title": "ITR eligibility and regime switching",
      "source": "https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/itr%204-faqs"
    },
    {
      "assessmentYear": "2027-28",
      "validFrom": "2027-04-01",
      "validTo": "2028-03-31",
      "verification": "not verified, needs CA confirmation",
      "id": "itr-2027-28",
      "title": "ITR eligibility and regime switching",
      "source": "https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/itr%204-faqs"
    },
    {
      "id": "advance-2026-27",
      "assessmentYear": "2026-27",
      "validFrom": "2025-04-01",
      "validTo": "2026-03-31",
      "title": "Advance tax: June 15%, September 45%, December 75%, March 100%; eligible presumptive cases March 100%",
      "verification": "Official advance-tax FAQ checked on 27 October 2026. The CA separately confirms the dated instalment and section table in rate confirmations.",
      "source": "https://www.incometaxindia.gov.in/documents/d/guest/faq-on-advance-tax"
    },
    {
      "id": "advance-2027-28",
      "assessmentYear": "2027-28",
      "validFrom": "2026-04-01",
      "validTo": "2027-03-31",
      "title": "Advance tax: June 15%, September 45%, December 75%, March 100%; eligible presumptive cases March 100%",
      "verification": "Official advance-tax FAQ checked on 27 October 2026. The CA separately confirms the dated instalment and section table in rate confirmations.",
      "source": "https://www.incometaxindia.gov.in/documents/d/guest/faq-on-advance-tax"
    }
  ],
  "rows": [
    {
      "id": "ita1961-80C",
      "act": "1961",
      "section": "80C",
      "title": "Life insurance, provident fund and eligible payments",
      "validFrom": "1962-04-01",
      "validTo": "2026-03-31",
      "replacedBy": "123",
      "source": "https://www.incometaxindia.gov.in/w/section-123-96",
      "verification": "Corresponding provision checked against official 2026 text; CA confirms applicability."
    },
    {
      "id": "ita2025-123-80C",
      "act": "2025",
      "section": "123",
      "title": "Life insurance, provident fund and eligible payments",
      "validFrom": "2026-04-01",
      "validTo": "2027-03-31",
      "replacedBy": null,
      "source": "https://www.incometaxindia.gov.in/w/section-123-96",
      "verification": "Official 2026 text checked; CA confirms applicability."
    },
    {
      "id": "ita1961-44AD",
      "act": "1961",
      "section": "44AD",
      "title": "Presumptive business income, subsection 2 table row 1",
      "validFrom": "1962-04-01",
      "validTo": "2026-03-31",
      "replacedBy": "58",
      "source": "https://www.incometaxindia.gov.in/w/section-58-144",
      "verification": "Corresponding provision checked against official 2026 text; CA confirms applicability."
    },
    {
      "id": "ita2025-58-44AD",
      "act": "2025",
      "section": "58",
      "title": "Presumptive business income, subsection 2 table row 1",
      "validFrom": "2026-04-01",
      "validTo": "2027-03-31",
      "replacedBy": null,
      "source": "https://www.incometaxindia.gov.in/w/section-58-144",
      "verification": "Official 2026 text checked; CA confirms applicability."
    },
    {
      "id": "ita1961-44ADA",
      "act": "1961",
      "section": "44ADA",
      "title": "Presumptive professional income, subsection 2 table row 3",
      "validFrom": "1962-04-01",
      "validTo": "2026-03-31",
      "replacedBy": "58",
      "source": "https://www.incometaxindia.gov.in/w/section-58-144",
      "verification": "Corresponding provision checked against official 2026 text; CA confirms applicability."
    },
    {
      "id": "ita2025-58-44ADA",
      "act": "2025",
      "section": "58",
      "title": "Presumptive professional income, subsection 2 table row 3",
      "validFrom": "2026-04-01",
      "validTo": "2027-03-31",
      "replacedBy": null,
      "source": "https://www.incometaxindia.gov.in/w/section-58-144",
      "verification": "Official 2026 text checked; CA confirms applicability."
    },
    {
      "id": "ita1961-194J",
      "act": "1961",
      "section": "194J",
      "title": "Professional fees, subsection 1 table row 6(iii)",
      "validFrom": "1962-04-01",
      "validTo": "2026-03-31",
      "replacedBy": "393",
      "source": "https://www.incometaxindia.gov.in/w/section-393-6",
      "verification": "Corresponding provision checked against official 2026 text; CA confirms applicability."
    },
    {
      "id": "ita2025-393-194J",
      "act": "2025",
      "section": "393",
      "title": "Professional fees, subsection 1 table row 6(iii)",
      "validFrom": "2026-04-01",
      "validTo": "2027-03-31",
      "replacedBy": null,
      "source": "https://www.incometaxindia.gov.in/w/section-393-6",
      "verification": "Official 2026 text checked; CA confirms applicability."
    }
  ],
  "tableHash": "ec8058fc5514238a04f999f3eab3d4146db6bd55c197c5c0e4e7c5b9181bbd03"
};
