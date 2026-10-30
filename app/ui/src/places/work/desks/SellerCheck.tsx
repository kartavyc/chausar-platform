// Full-label hit area keeps owner confirmations readable on phones.
import type {InputHTMLAttributes} from 'react';import s from './SellerCheck.module.css';
export function SellerCheck({label,...props}:InputHTMLAttributes<HTMLInputElement>&{label:string}){return <label className={s.check}><input {...props} type="checkbox"/><span>{label}</span></label>;}
