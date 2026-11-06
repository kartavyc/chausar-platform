export function scopeInputPhrase(playbookId: string, phrase: string): string | null {
  const words = Object.hasOwn(PHRASES, playbookId) ? PHRASES[playbookId]! : null;
  return words && Object.hasOwn(words, phrase) ? words[phrase]! : null;
}

// Non-display input phrases: preserve the shipped client scope checks independently of UI translations.
// Only scope.inScope/outOfScope phrases are retained; these are never presented as app copy.
const PHRASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "seo-visibility": {
    "site checks": "साइट जाँच",
    "search visibility": "खोज में दिखना",
    "AI answer checks": "एआई उत्तर जाँच",
    "ranking guarantees": "रैंक की गारंटी",
    "link schemes": "लिंक योजनाएँ",
    "scraping Google results": "गूगल नतीजों को स्क्रैप करना"
  },
  "online-seller": {
    "seller audits": "विक्रेता की जांच",
    "listings": "लिस्टिंग",
    "settlements": "भुगतान का मिलान",
    "ads reports": "विज्ञापन रिपोर्ट",
    "bought reviews": "खरीदी गई समीक्षाएं",
    "automated claims": "अपने आप भेजे दावे",
    "government filing": "सरकारी आवेदन"
  },
  "support-desk": {
    "customer mail": "क्लाइंट मेल",
    "support replies": "सहायता जवाब",
    "help pages": "सहायता पृष्ठ",
    "automatic refunds": "अपने आप पैसे लौटाना",
    "legal advice": "कानूनी सलाह",
    "automatic sending": "अपने आप भेजना"
  },
  "recruiting-desk": {
    "role intake": "पद की जानकारी",
    "resume screening": "रेज़्यूमे जाँच",
    "interview scheduling": "इंटरव्यू समय",
    "automatic rejection": "स्वचालित अस्वीकृति",
    "profile scraping": "प्रोफ़ाइल खंगालना"
  },
  "job-search-desk": {
    "career research": "करियर शोध",
    "approved fact-based drafting": "मंज़ूर तथ्यों पर ड्राफ़्ट",
    "automatic applications": "अपने आप आवेदन",
    "invented experience": "गढ़ा हुआ अनुभव"
  },
  "translation-studio": {
    "document translation": "दस्तावेज़ का अनुवाद",
    "subtitle translation": "सबटाइटल का अनुवाद",
    "Dubbing": "डबिंग",
    "Live captions": "लाइव कैप्शन",
    "certified legal translations": "प्रमाणित कानूनी अनुवाद"
  },
  "bookkeeping-cfo": {
    "bookkeeping": "बहीखाता",
    "collections": "वसूली",
    "cash": "नकदी",
    "spending": "खर्च",
    "finance memo": "वित्तीय नोट",
    "investment advice": "निवेश सलाह",
    "tax filing": "कर दाखिल करना",
    "legal demand": "कानूनी मांग",
    "government portal": "सरकारी पोर्टल"
  },
  "podcast-to-article": {
    "episode articles": "एपिसोड के लेख",
    "show notes": "शो नोट्स",
    "newsletter blurbs": "न्यूज़लेटर के अंश",
    "invented quotes": "गढ़े हुए उद्धरण",
    "unapproved publication": "बिना मंज़ूरी प्रकाशन"
  },
  "lead-generation": {
    "lead research": "संभावित ग्राहकों पर शोध",
    "outreach drafts": "संपर्क संदेशों के मसौदे",
    "appointment setting": "मुलाकात तय करना",
    "community research": "समुदाय पर शोध",
    "selling raw lead lists": "कच्ची ग्राहक सूचियाँ बेचना",
    "automated LinkedIn messages": "अपने आप लिंक्डइन संदेश भेजना",
    "cold WhatsApp": "बिना सहमति व्हाट्सऐप संदेश",
    "promotional calls": "प्रचार कॉल"
  },
  "newsletter-studio": {
    "Client newsletters": "क्लाइंट के न्यूज़लेटर",
    "Own newsletters": "अपने न्यूज़लेटर",
    "Bought lists": "खरीदी हुई सूचियाँ",
    "Unapproved sends": "बिना मंज़ूरी भेजना"
  },
  "tender-desk": {
    "RFP answers": "आरएफपी के उत्तर",
    "Client document buckets": "क्लाइंट दस्तावेज़ों के संग्रह",
    "Compliance matrices": "अनुपालन तालिकाएँ",
    "Portal login": "पोर्टल लॉगिन",
    "Automatic portal submission": "पोर्टल पर अपने आप जमा करना",
    "Legal certification": "कानूनी प्रमाणन"
  },
  "website-studio": {
    "Business websites": "बिज़नेस वेबसाइटें",
    "Landing pages": "लैंडिंग पेज",
    "Website care": "वेबसाइट देखभाल",
    "Website form capture": "वेबसाइट फ़ॉर्म से अनुरोध लेना",
    "Unapproved releases": "बिना मंज़ूरी रिलीज़",
    "Signed app updates": "हस्ताक्षरित ऐप अपडेट"
  },
  "narration-studio": {
    "Audiobooks": "ऑडियोबुक",
    "Narrated lessons": "आवाज़ वाले पाठ",
    "Source-quoted explainers": "स्रोत के उद्धरण वाली रील",
    "Unconsented cloning": "बिना सहमति आवाज़ की नकल",
    "Automatic distributor submission": "अपने आप वितरक को भेजना",
    "Private cloud synthesis": "निजी पाठ से क्लाउड आवाज़ बनाना"
  },
  "virtual-assistant": {
    "Client routines and research": "क्लाइंट के नियमित काम और शोध",
    "Manual errands planning": "छोटे कामों की हाथ से योजना",
    "Entering payment details": "भुगतान की जानकारी भरना",
    "Unapproved messages or purchases": "बिना मंज़ूरी संदेश या खरीद"
  },
  "data-entry-desk": {
    "Permitted native client forms": "अनुमति वाले साधारण क्लाइंट फ़ॉर्म",
    "Exact source entry and comparison": "हूबहू स्रोत एंट्री और तुलना",
    "Government and marketplace seller portals": "सरकारी और बाज़ार विक्रेता पोर्टल",
    "Dynamic or autosaving forms": "बदलते या अपने आप सेव होने वाले फ़ॉर्म"
  },
  "app-testing": {
    "Client Android emulator tests": "क्लाइंट Android एमुलेटर परीक्षण",
    "Test-account software demos": "परीक्षण अकाउंट वाले सॉफ़्टवेयर डेमो",
    "Real phones and personal accounts": "असली फ़ोन और निजी अकाउंट",
    "Recording the owner desktop": "मालिक का डेस्कटॉप रिकॉर्ड करना"
  },
  "dev-agency": {
    "Source maintenance reviews": "स्रोत रखरखाव समीक्षा",
    "Source QA reviews": "स्रोत गुणवत्ता समीक्षा",
    "Permitted source security reviews": "अनुमति वाली स्रोत सुरक्षा समीक्षा",
    "Live-system testing": "चलते सिस्टम की जाँच",
    "Exploit instructions": "हमला करने के निर्देश",
    "Automatic repository writes": "अपने आप रिपॉज़िटरी बदलना"
  },
  "monitored-data": {
    "Approved source evidence and exact exports": "मंज़ूर स्रोत प्रमाण और सटीक निर्यात",
    "Unapproved sends or policy evasion": "बिना मंज़ूरी भेजना या नीति से बचना"
  },
  "it-triage": {
    "Approved source evidence and exact exports": "मंज़ूर स्रोत प्रमाण और सटीक निर्यात",
    "Unapproved sends or policy evasion": "बिना मंज़ूरी भेजना या नीति से बचना"
  },
  "phone-receptionist": {
    "Approved scripts and imported call logs": "मंज़ूर स्क्रिप्ट और आयात किए कॉल लॉग",
    "Receipted costs and human follow-up": "रसीद वाली लागत और व्यक्ति का अगला काम",
    "Promotional outbound calls": "प्रचार के लिए बाहर कॉल",
    "Booking, charging or medical advice by an agent": "एजेंट द्वारा बुकिंग, भुगतान या चिकित्सा सलाह"
  }
};
