// Original R2 data contracts. JobOS and Qwen-CUA (Apache-2.0) informed snapshot identity and action holds; no code copied.
export type FormFieldKind='text'|'textarea'|'select'|'checkbox'|'submit'|'button'|'role-button'|'password'|'file'|'download'|'link'|'unknown';
export type FormTarget={id:string;fingerprint:string;pageHash:string;name:string;kind:FormFieldKind;disabled:boolean;inForm:boolean};
export type FormMappedValue={targetId:string;fingerprint:string;pageHash:string;value:string};
export type FormDifference={targetId:string;expected:string;actual:string|null};
export type FormReadback={status:'matches'|'saved-differently'|'not-checked';recordId:string|null;differences:FormDifference[]};
