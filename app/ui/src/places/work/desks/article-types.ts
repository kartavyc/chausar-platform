import type {ArticleLedgerBody,ArticleBundle} from '../../../../../../platform/runtime/venture/playbooks/podcast-to-article/records';
import type {checkArticleBundle} from '../../../../../../platform/runtime/venture/playbooks/podcast-to-article/state';
export type ArticleView=ArticleLedgerBody&{id:string;stale:boolean;checks:ReturnType<typeof checkArticleBundle>|null};
export type ArticleAct=(id:string,action:string,payload:Record<string,unknown>,digest?:string)=>Promise<{id:string;result:any}|null>;
export type {ArticleBundle};
