import { useState, type InputHTMLAttributes } from 'react';
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;
export default function SecretInput({ className = '', ...props }: Props) {
 const [visible,setVisible] = useState(false);
 return <div className="relative"><input {...props} type={visible?'text':'password'} className={`${className} pr-12`} /><button type="button" disabled={props.disabled} onClick={()=>setVisible(value=>!value)} aria-label={visible?'Ukryj wpisaną wartość':'Pokaż wpisaną wartość'} aria-pressed={visible} title={visible?'Ukryj':'Pokaż'} className="absolute bottom-2 right-2 rounded-md p-2 text-slate-400 hover:bg-slate-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{visible&&<path d="m3 3 18 18"/>}</svg></button></div>;
}
