import {useEffect,useRef,useState} from 'react';

/** Images cannot send Authorization headers: fetch using the session before displaying. */
export default function AuthenticatedImage({url,fetcher,alt,className='',lazy=false}:{url:string;fetcher:typeof fetch;alt:string;className?:string;lazy?:boolean}){
 const element=useRef<HTMLSpanElement>(null);
 const [visible,setVisible]=useState(!lazy),[image,setImage]=useState<{source:string;url:string;failed:boolean}>({source:'',url:'',failed:false});
 useEffect(()=>{if(!lazy||typeof IntersectionObserver==='undefined'){setVisible(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'150px'});if(element.current)observer.observe(element.current);return()=>observer.disconnect();},[lazy,url]);
 useEffect(()=>{if(!visible)return;let active=true,objectUrl='';const controller=new AbortController();setImage({source:url,url:'',failed:false});
  void fetcher(url,{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error('Nie można pobrać obrazu.');const blob=await response.blob();if(!active)return;objectUrl=URL.createObjectURL(blob);setImage({source:url,url:objectUrl,failed:false});}).catch(()=>{if(active&&!controller.signal.aborted)setImage({source:url,url:'',failed:true});});
  return()=>{active=false;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[url,fetcher,visible]);
 const source=image.source===url?image.url:'';
 return <span ref={element} className={`flex items-center justify-center ${className}`}>{source?<img src={source} alt={alt} className="h-full w-full object-contain" onError={()=>setImage({source:url,url:'',failed:true})}/>:image.source===url&&image.failed?<span role="img" aria-label={`Podgląd niedostępny: ${alt}`} className="p-1 text-center text-xs text-slate-500">📄</span>:<span role="status" aria-label="Wczytywanie obrazu" className="text-xs text-slate-500">…</span>}</span>;
}
