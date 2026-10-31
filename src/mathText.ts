import katex from 'katex';

function escapeHtml(text:string) {
  return text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}
function escaped(text:string,index:number) {
  let slashes=0;while(index>0&&text[--index]==='\\')slashes++;
  return slashes%2===1;
}
function groupEnd(text:string,start:number) {
  const open=text[start],close=open==='{'?'}':']';let depth=0;
  for(let i=start;i<text.length;i++){
    if(escaped(text,i))continue;
    if(text[i]===open)depth++;
    if(text[i]===close&&--depth===0)return i+1;
  }
  return -1;
}
// Legacy answers sometimes omit math delimiters. Only consume explicit TeX
// commands and single-letter sub/superscripts; never guess ordinary prose.
function bareAtomEnd(text:string,start:number,depth=0):number {
  if(depth>20)return start;
  const command=text.slice(start).match(/^\\[a-zA-Z]+/);
  let end=command?start+command[0].length:start+1;
  while(end<text.length){
    let next=end;while(text[next]===' ')next++;
    if(text[next]==='{'||(command?.[0]==='\\sqrt'&&text[next]==='[')){
      const close=groupEnd(text,next);if(close<0)return text.indexOf('\n',next)<0?text.length:text.indexOf('\n',next);
      end=close;continue;
    }
    if(text[end]==='_'||text[end]==='^'){
      const argument=end+1;
      if(text[argument]==='{'){const close=groupEnd(text,argument);if(close<0)return text.length;end=close;}
      else if(text[argument]==='\\')end=bareAtomEnd(text,argument,depth+1);
      else if(/[a-zA-Z0-9]/.test(text[argument]||''))end=argument+1;
      else break;
      continue;
    }
    break;
  }
  return end;
}

function renderMath(expression:string,original:string,display=false) {
  try {
    const html=katex.renderToString(expression,{displayMode:display,throwOnError:true,trust:false,strict:'ignore',maxExpand:500,maxSize:10});
    return `<${display?'div':'span'} class="explanation-math${display?' display-math':''}">${html}</${display?'div':'span'}>`;
  }catch{return `<code class="math-fallback" title="此表达式暂无法排版，保留原始内容">${escapeHtml(original)}</code>`;}
}

export function renderMathText(text:string) {
  const output:string[]=[];let plain='';
  const flush=()=>{if(plain){output.push(escapeHtml(plain));plain='';}};
  for(let i=0;i<text.length;){
    if(!escaped(text,i)){
      const marker=text.startsWith('\\[',i)?['\\[','\\]',true] as const:text.startsWith('\\(',i)?['\\(','\\)',false] as const:text.startsWith('$$',i)?['$$','$$',true] as const:text[i]==='$'&&!/\s/.test(text[i+1]||' ')?['$','$',false] as const:null;
      if(marker){
        const [open,close,display]=marker;let end=text.indexOf(close,i+open.length);
        while(end>=0&&(escaped(text,end)||(open==='$'&&(/\s/.test(text[end-1]||' ')||/\d/.test(text[end+1]||'')))))end=text.indexOf(close,end+close.length);
        if(end>=0){flush();const after=end+close.length;output.push(renderMath(text.slice(i+open.length,end),text.slice(i,after),display));i=after;continue;}
      }
      if(text[i]==='`'&&text[i+1]!=='`'){
        const end=text.indexOf('`',i+1);
        if(end>i+1&&!text.slice(i,end).includes('\n')){
          flush();const content=text.slice(i+1,end);
          output.push(/\\[a-zA-Z]|\b[a-zA-Z][_^]/.test(content)?renderMath(content,content):`<code>${escapeHtml(content)}</code>`);i=end+1;continue;
        }
      }
      const command=text[i]==='\\'&&/[a-zA-Z]/.test(text[i+1]||'');
      const subscript=/[a-zA-Z]/.test(text[i])&&/[_^]/.test(text[i+1]||'')&&!/[\w]/.test(text[i-1]||'');
      if(command||subscript){
        let end=bareAtomEnd(text,i);
        while(text[end]==='\\'&&/[a-zA-Z]/.test(text[end+1]||''))end=bareAtomEnd(text,end);
        flush();const expression=text.slice(i,end);output.push(renderMath(expression,expression));i=end;continue;
      }
    }
    plain+=text[i++];
  }
  flush();return output.join('');
}
