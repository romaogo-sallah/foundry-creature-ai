import {availableParallelism} from 'node:os';
import {readdir,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
let jobs=Number(process.env.TEST_JOBS??Math.min(64,Math.max(1,availableParallelism()-1)));
const index=args.indexOf('--jobs');
if(index>=0){jobs=Number(args[index+1]);args.splice(index,2);}
if(!Number.isInteger(jobs)||jobs<1||jobs>64)throw new Error('Use --jobs 1..64 or TEST_JOBS=1..64');
let files=args.length?args:(await readdir(new URL('../test/',import.meta.url))).filter(name=>name.endsWith('.test.mjs')).map(name=>`test/${name}`);
if(!args.length){
 const sized=await Promise.all(files.map(async file=>({file,size:(await stat(new URL(`../${file}`,import.meta.url))).size})));
 files=sized.sort((a,b)=>b.size-a.size||a.file.localeCompare(b.file)).map(e=>e.file);
}
console.error(`Running ${files.length} test files in up to ${jobs} isolated processes. Cases within each file remain sequential to protect Foundry globals.`);
const started=performance.now(),child=spawn(process.execPath,['--test',`--test-concurrency=${jobs}`,...files],{cwd:root,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',(code,signal)=>{console.error(`Test run finished in ${((performance.now()-started)/1000).toFixed(1)}s with ${jobs} workers.`);process.exitCode=code??(signal?1:0);});
