import type {IncomingMessage} from 'node:http';

// Count wire bytes before decoding so a packet boundary cannot split a character.
export async function readUtf8Body(req:IncomingMessage,limit:number):Promise<string|undefined>{
  const chunks:Buffer[]=[];
  let size=0;
  for await(const chunk of req.iterator({destroyOnReturn:false})){
    size+=chunk.length;
    if(size>limit){req.resume();return undefined;}
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size).toString('utf8');
}
