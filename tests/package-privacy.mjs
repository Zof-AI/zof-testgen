// Copied into the clean installation directory by package.mjs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {generateTests,generateTestsWithOllama,writeCandidates,SafeInputError} from '@zofai/testgen';

const sensitive='ghp_'+'A'.repeat(36);
const input={language:'typescript',source:'export function example(value: string) { return value; }',functions:['example'],module:'../fixture.ts',reproductions:[{function:'example',args:[sensitive],expected:sensitive}]};
const copy=structuredClone(input);
assert.throws(()=>generateTests(input),error=>error instanceof SafeInputError&&error.code==='GENERATION_INPUT_SENSITIVE'&&!error.message.includes(sensitive));
assert.deepEqual(input,copy);
let requests=0;
const server=createServer((_request,response)=>{requests++;response.writeHead(500);response.end();});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const options={allowLocalModel:true,model:'synthetic:local',port:server.address().port,timeoutMs:100};
  await assert.rejects(generateTestsWithOllama({...input,reproductions:[],source:`export function example(value: string) { return '${sensitive}'; }`},options),error=>error instanceof SafeInputError&&error.code==='GENERATION_INPUT_SENSITIVE');
  assert.equal(requests,0);
  const root=resolve('privacy-fixture');await mkdir(root);
  await writeFile(resolve(root,'fixture.ts'),input.source);
  await writeFile(resolve(root,'config.json'),JSON.stringify({language:input.language,sourcePath:'fixture.ts',functions:input.functions,module:input.module,reproductions:input.reproductions}));
  const cli=resolve('node_modules/@zofai/testgen/dist/cli.js');
  for(const flags of [['--json'],['--json','--write']]){
    const output=spawnSync(process.execPath,[cli,'config.json','--root',root,...flags],{encoding:'utf8',env:{PATH:process.env.PATH}});
    assert.equal(output.status,2);assert.equal(output.stdout,'');assert.ok(!output.stderr.includes(sensitive));
  }
  await assert.rejects(access(resolve(root,'generated')));
  const forged=generateTests({...input,reproductions:[]});forged.files[0].content=`export const data='${sensitive}';`;
  await assert.rejects(writeCandidates(root,forged,{dryRun:false}),error=>error instanceof SafeInputError&&error.code==='GENERATION_OUTPUT_SENSITIVE');
  await assert.rejects(access(resolve(root,'generated')));
  console.log(JSON.stringify({status:'passed',checks:4,privacy:'SEC-011',liveModel:'NOT_RUN'}));
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
