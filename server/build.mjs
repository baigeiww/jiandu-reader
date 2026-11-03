import {build} from 'esbuild';
await build({entryPoints:['server/main.ts'],outfile:'dist-server/reader.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',minify:true});
await build({entryPoints:['server/app.ts'],outfile:'dist-server/app.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',minify:true});
