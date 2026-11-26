import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url))),port=Number(process.env.COMBAT_LAB_PORT??process.argv[2]??4173);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Combat lab port must be 1..65535');
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};

const server=createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/'){response.writeHead(302,{location:'/web/combat-lab/'});response.end();return;}
    const relative=pathname==='/web/combat-lab/'?'web/combat-lab/index.html':pathname.replace(/^\/+/,''),top=relative.split('/')[0];
    if(!['web','simulations','src'].includes(top))throw Object.assign(new Error('Forbidden'),{status:403});
    const file=path.resolve(root,relative);
    if(file!==root&&!file.startsWith(root+path.sep))throw Object.assign(new Error('Forbidden'),{status:403});
    if(!(await stat(file)).isFile())throw Object.assign(new Error('Not found'),{status:404});
    response.writeHead(200,{'content-type':types[path.extname(file)]??'application/octet-stream','cache-control':'no-store'});response.end(await readFile(file));
  }catch(error){response.writeHead(error.status??404,{'content-type':'text/plain; charset=utf-8'});response.end(error.status===403?'Forbidden':'Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Combat Lab: http://127.0.0.1:${port}/\nPress Ctrl+C to stop.`));
