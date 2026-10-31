import {useMemo} from 'react';
import {renderMathText} from './mathText';
import 'katex/dist/katex.min.css';

export function MathExplanation({text}:{text:string}) {
  const html=useMemo(()=>renderMathText(text),[text]);
  // Prose is escaped; only KaTeX-generated, trust:false math becomes markup.
  return <div className="formula-explanation" dangerouslySetInnerHTML={{__html:html}}/>;
}
