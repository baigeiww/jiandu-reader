export const SIDEBAR_WIDTH_KEY='reader-sidebar-width';
export const DEFAULT_SIDEBAR_WIDTH=440;
export const MIN_SIDEBAR_WIDTH=280;
export const MAX_SIDEBAR_WIDTH=720;
export function readSidebarWidth(storage:Pick<Storage,'getItem'>){
  try{const raw=storage.getItem(SIDEBAR_WIDTH_KEY);if(raw!==null){const value=Number(raw);if(Number.isFinite(value)&&value>=MIN_SIDEBAR_WIDTH&&value<=MAX_SIDEBAR_WIDTH)return Math.round(value);}}catch{/* Resizing still works if storage is unavailable. */}
  return DEFAULT_SIDEBAR_WIDTH;
}
export function sidebarWidthLimit(viewport:number){return Math.max(1,Math.min(MAX_SIDEBAR_WIDTH,viewport-(viewport>=1100?560:20)));}
export function fitSidebarWidth(preferred:number,viewport:number){const max=sidebarWidthLimit(viewport);return Math.round(Math.min(max,Math.max(Math.min(MIN_SIDEBAR_WIDTH,max),preferred)));}
