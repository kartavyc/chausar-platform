// Original house writing rules. Upstream Chinese style measurements are not English or Hindi evidence.
import type {DatedRule} from '../kit/define.ts';
import {ARTICLE_QUOTE_RULE} from './legal-core.ts';
const source={title:'Podcast article workflow',url:'https://github.com/orange2ai/podcast-to-article/blob/main/SKILL.md'};
export const ARTICLE_RULES:readonly DatedRule[]=[
 {id:'house-style',scope:'house',topic:'English and Hindi house style',rule:'Compare measured rates with the labelled Chausar house samples.',sources:[source],checkedOn:'2026-10-28',read:'house',how:'Original English and Hindi sample paragraphs measured in code.',usedBy:['article-evidence','draft','check'],limitations:'House samples are guidance, not a population benchmark. Chinese source rates are not reused.',needs:null},
 {id:'quote-share',scope:'house',topic:'Episode quote share',rule:'Keep the quotation share in the house band and check exact source quotations.',value:'10..28',unit:'percent',sources:[source],checkedOn:'2026-10-28',read:'house',how:'Count quoted characters in code and compare quotations with cited episode facts.',usedBy:['article-evidence','draft','check'],limitations:'Matching words cannot confirm context or meaning. The owner still reviews attribution.',needs:null},
 ARTICLE_QUOTE_RULE,
];
