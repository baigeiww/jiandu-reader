import {headingLabels} from './samples';
export type DirectoryItem={id:string;text:string};
const common:Record<string,string>={...headingLabels,Abstract:'摘要',Introduction:'引言',Method:'方法',Experiments:'实验',Experiment:'实验',Results:'结果',Discussion:'讨论',Conclusion:'结论',Conclusions:'结论',Acknowledgement:'致谢',Acknowledgements:'致谢',References:'参考文献'};
export function splitHeading(text:string){
  const match=text.match(/^((?:Appendix\s+[A-Z](?:\.\d+)*|[A-Z](?:\.\d+)+|\d+(?:\.\d+)*)(?:[.:]?\s+))(.+)$/);
  return match?{prefix:match[1].replace(/^Appendix\s+/,'附录 '),text:match[2]}:{prefix:'',text};
}
export function knownHeading(text:string){const part=splitHeading(text);return common[part.text]?part.prefix+common[part.text]:/[\u3400-\u9fff]/.test(part.text)?part.prefix+part.text:undefined;}
export function parseDirectoryResponse(output:string,items:DirectoryItem[]):Record<string,string>{
  let data:unknown;try{data=JSON.parse(output.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/,'$1'));}catch{throw Error('目录译文格式不完整，请重试。');}
  if(!Array.isArray(data))throw Error('目录译文条目不完整，请重试。');
  const labels:Record<string,string>={};
  for(const item of items){const matches=data.filter(row=>row&&row.id===item.id);const translation=matches[0]?.translation;
    if(matches.length!==1||typeof translation!=='string'||!translation.trim()||translation.length>2500)throw Error('目录译文条目不完整，请重试。');
    const part=splitHeading(item.text);
    labels[item.id]=part.prefix+(part.prefix?splitHeading(translation.trim()).text:translation.trim());
  }
  return labels;
}
