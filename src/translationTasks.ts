import {cacheKey} from './core';
import {untranslatedBlocks,type Block,type TranslationScope} from './paper';
import type {Paper,Result} from './library';
import type {Settings} from './settings';

export type TaskStatus='queued'|'running'|'pausing'|'paused'|'completed'|'cancelled'|'failed';
export type TranslationTask={source:string;title:string;scope:TranslationScope;status:TaskStatus;total:number;done:number;saved:number;failures:number;model:string;activeId?:string;error?:string};
type Work={view:TranslationTask;paper:Paper;settings:Settings;results:Record<string,Result>;controller:AbortController;failed:Set<string>;created:number};
type Dependencies={
  read:(source:string)=>Promise<Record<string,Result>>;
  cached:(key:string)=>Promise<Result|undefined>;
  translate:(block:Block,settings:Settings,signal:AbortSignal)=>Promise<Result>;
  save:(source:string,id:string,key:string,result:Result)=>Promise<{result:Result;saved:boolean}>;
  result:(source:string,id:string,result:Result)=>void;
};
export class TranslationTasks {
  private works=new Map<string,Work>();
  private listeners=new Set<()=>void>();
  private working=false;
  constructor(private deps:Dependencies){}
  snapshot=()=>[...this.works.values()].map(w=>({...w.view}));
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private emit(){for(const listener of this.listeners)listener();}
  active(source:string){const view=this.works.get(source)?.view;return view&&!['completed','cancelled'].includes(view.status)?view:undefined;}
  start(paper:Paper,settings:Settings,scope:TranslationScope,results:Record<string,Result>){
    if(this.active(paper.source))return false;
    const targets=untranslatedBlocks(paper.blocks,{},scope);
    const view:TranslationTask={source:paper.source,title:paper.title,scope,status:'queued',total:targets.length,done:targets.length-untranslatedBlocks(targets,results).length,saved:0,failures:0,model:settings.provider.startsWith('google')?'Google':settings.model};
    this.works.set(paper.source,{view,paper:{...paper,html:''},settings:{...settings},results:{...results},controller:new AbortController(),failed:new Set(),created:Date.now()});
    this.emit();void this.pump();return true;
  }
  pause(source:string){
    const work=this.works.get(source);if(!work||!['queued','running'].includes(work.view.status))return;
    work.view.status=work.view.status==='running'?'pausing':'paused';this.emit();
  }
  resume(source:string){
    const work=this.works.get(source);if(!work||(!['paused','pausing','failed'].includes(work.view.status)&&!(work.view.status==='completed'&&work.view.failures)))return;
    if(work.view.status==='pausing'){work.view.status='running';this.emit();return;}
    work.view.status='queued';work.view.error=undefined;work.view.failures=0;work.failed.clear();this.emit();void this.pump();
  }
  cancel(source:string){
    const work=this.works.get(source);if(!work||['completed','cancelled'].includes(work.view.status))return;
    work.view.status='cancelled';work.controller.abort();this.release(work);this.emit();
  }
  private release(work:Work){work.paper={...work.paper,html:'',blocks:[]};work.results={};work.settings={...work.settings,key:''};}
  dismiss(source:string){const work=this.works.get(source);if(work&&['completed','cancelled'].includes(work.view.status)){this.works.delete(source);this.emit();}}
  stop(){for(const source of this.works.keys())this.cancel(source);}
  private async pump(){
    if(this.working)return;this.working=true;
    try{
      for(;;){
        const work=[...this.works.values()].filter(w=>w.view.status==='queued').sort((a,b)=>a.created-b.created)[0];
        if(!work)break;
        await this.run(work);
      }
    }finally{this.working=false;}
  }
  private async run(work:Work){
    const {view,paper,settings}=work;view.status='running';this.emit();
    try{
      for(;;){
        if(!['running'].includes(view.status))break;
        work.results={...work.results,...await this.deps.read(paper.source)};
        if(!['running'].includes(view.status))break;
        const missing=untranslatedBlocks(paper.blocks,work.results,view.scope);view.done=view.total-missing.length;
        for(const id of work.failed)if(work.results[id]?.html.trim())work.failed.delete(id);
        view.failures=work.failed.size;
        if(!view.failures)view.error=undefined;
        const pending=missing.filter(block=>!work.failed.has(block.id));
        if(!pending.length){view.status='completed';view.activeId=undefined;this.emit();return;}
        const block=pending[0];view.activeId=block.id;this.emit();
        const key=cacheKey(paper.source,block.input,settings.provider+':'+settings.endpoint,settings.model,settings.glossary);
        let result=await this.deps.cached(key);
        if(!['running'].includes(view.status))break;
        if(!result?.html.trim()){
          try{result=await this.deps.translate(block,settings,work.controller.signal);if(!result?.html.trim())throw Error('服务未返回有效译文。');}
          catch(error){
            if(work.controller.signal.aborted)break;
            work.failed.add(block.id);view.failures=work.failed.size;
            view.error=block.id+'：'+(error instanceof Error?error.message:String(error));this.emit();
            if(['pausing'].includes(view.status)){view.status='paused';break;}
            continue;
          }
        }
        if(['cancelled'].includes(view.status))break;
        if(!result?.html.trim())throw Error('服务未返回有效译文。');
        const stored=await this.deps.save(paper.source,block.id,key,result);
        work.results[block.id]=stored.result;view.saved+=Number(stored.saved);view.done++;
        this.deps.result(paper.source,block.id,stored.result);
        if(view.done>=view.total){view.status='completed';return;}
        if(['pausing'].includes(view.status)){view.status='paused';break;}
        this.emit();
      }
    }catch(error){
      if(!['paused','cancelled','queued'].includes(view.status)){view.status='failed';view.error=(view.activeId?view.activeId+'：':'')+(error instanceof Error?error.message:String(error));}
    }finally{if(['pausing'].includes(view.status))view.status='paused';if(view.status!=='failed')view.activeId=undefined;if(['cancelled'].includes(view.status)||(view.status==='completed'&&!view.failures))this.release(work);this.emit();}
  }
}
