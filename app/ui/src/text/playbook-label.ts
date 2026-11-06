import labels from './en/playbook-labels.json';
import type {T} from './index';
/** Translate only a known code-owned label. Owner/custom and unknown engine text stays untouched. */
export function playbookLabel(t:T,pick:{id:string;label:string}|null|undefined):string|undefined {
 if(!pick)return undefined;
 const key='playbook-labels.'+pick.id;
 return (labels as Readonly<Record<string,string>>)[key]===pick.label?t(key):pick.label;
}
