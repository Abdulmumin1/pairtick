import type { RunLine } from "./cometchat";

/** Runs JS in a throwaway sandboxed iframe and collects console output. */
export function runCode(code: string, timeoutMs = 3000): Promise<RunLine[]> {
  return new Promise((resolve) => {
    const out: RunLine[] = [];
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";
    const token = Math.random().toString(36).slice(2);

    const finish = () => {
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
      iframe.remove();
      resolve(out);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow || e.data?.token !== token) return;
      if (e.data.done) return finish();
      out.push({ kind: e.data.kind, text: e.data.text });
    };
    const timer = setTimeout(() => {
      out.push({ kind: "error", text: `timed out after ${timeoutMs}ms` });
      finish();
    }, timeoutMs);

    window.addEventListener("message", onMsg);
    const src = `<script>
      const T=${JSON.stringify(token)};
      const fmt=(a)=>a.map(x=>{try{return (x!==null&&typeof x==='object')?JSON.stringify(x):String(x)}catch{return String(x)}}).join(' ');
      const post=(kind,args)=>parent.postMessage({token:T,kind,text:fmt(args)},'*');
      console.log=(...a)=>post('log',a); console.info=(...a)=>post('log',a);
      console.warn=(...a)=>post('error',a); console.error=(...a)=>post('error',a);
      console.assert=(c,...a)=>{ if(!c) post('error',['Assertion failed:',...a]) };
      window.onerror=(m,_s,l)=>{post('error',[m+(l?' (line '+l+')':'')]);};
      window.onunhandledrejection=(e)=>post('error',['Unhandled: '+(e.reason&&e.reason.message||e.reason)]);
      (async()=>{ try { await (async()=>{ ${code.replace(/<\/script/gi, "<\\/script")}
      })(); } catch(e){ post('error',[e&&e.stack?String(e.stack).split('\\n')[0]:String(e)]) }
      setTimeout(()=>parent.postMessage({token:T,done:true},'*'),30); })();
    <\/script>`;
    iframe.srcdoc = src;
    document.body.appendChild(iframe);
  });
}
