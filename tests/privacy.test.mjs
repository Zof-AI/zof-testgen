import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateTests,generateTestsWithOllama,writeCandidates,SafeInputError} from '../dist/index.js';

const sensitive='ghp_'+'A'.repeat(36);
const input={language:'typescript',source:'export function example(value: string) { return value; }',functions:['example'],module:'../fixture.ts',reproductions:[{function:'example',args:['plain'],expected:'plain'}]};
const safe=error=>error instanceof SafeInputError&&error.code==='GENERATION_INPUT_SENSITIVE'&&!error.message.includes(sensitive);

test('security: recognized sensitive reproduction values, keys and metadata reject without changing oracles',()=>{
  for(const altered of [
    {...input,reproductions:[{function:'example',args:[sensitive],expected:'plain'}]},
    {...input,reproductions:[{function:'example',args:['plain'],expected:sensitive}]},
    {...input,reproductions:[{function:'example',args:[{nested:{apiKey:'synthetic-value'}}],expected:{token:'synthetic-value'}}]},
    {...input,source:`export function ${sensitive}(value: string) { return value; }`,functions:[sensitive],reproductions:[]},
    {...input,module:`../${sensitive}.ts`},
    {...input,coveredBranches:[sensitive]},
  ]){const before=structuredClone(altered);assert.throws(()=>generateTests(altered),safe);assert.deepEqual(altered,before);}
  const ordinary=generateTests(input);assert.match(ordinary.files[0].content,/plain/);
});

test('security: selected sensitive source and reproductions reject before any local-model request',async()=>{
  let requests=0;
  const server=createServer((_request,response)=>{requests++;response.writeHead(500);response.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const options={allowLocalModel:true,model:'synthetic:local',port:server.address().port,timeoutMs:100};
  try{
    await assert.rejects(generateTestsWithOllama({...input,source:`export function example(value: string) { return "${sensitive}"; }`},options),safe);
    await assert.rejects(generateTestsWithOllama({...input,reproductions:[{function:'example',args:[sensitive],expected:sensitive}]},options),safe);
    await assert.rejects(generateTestsWithOllama({...input,functions:[sensitive],source:`export function ${sensitive}(value:string){return value;}`,reproductions:[]},options),safe);
    await assert.rejects(generateTestsWithOllama(input,{...options,model:sensitive}),safe);
    assert.equal(requests,0);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('security: CLI and public writer cannot emit recognized credentials or create their files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'testgen-privacy-'));
  try{
    await writeFile(join(root,'fixture.ts'),input.source);
    await writeFile(join(root,'config.json'),JSON.stringify({language:input.language,sourcePath:'fixture.ts',functions:input.functions,module:input.module,reproductions:[{function:'example',args:[sensitive],expected:sensitive}]}));
    for(const flags of [['--json'],['--json','--write']]){
      const output=spawnSync(process.execPath,['dist/cli.js','config.json','--root',root,...flags],{encoding:'utf8',env:{PATH:process.env.PATH}});
      assert.equal(output.status,2);assert.ok(!(output.stdout+output.stderr).includes(sensitive));assert.equal(output.stdout,'');
    }
    await assert.rejects(access(join(root,'generated')));
    const forged=generateTests(input);forged.files[0].content=`export const fixture = '${sensitive}';`;
    await assert.rejects(writeCandidates(root,forged,{dryRun:false}),error=>error instanceof SafeInputError&&error.code==='GENERATION_OUTPUT_SENSITIVE'&&!error.message.includes(sensitive));
    await assert.rejects(access(join(root,'generated')));
  }finally{await rm(root,{recursive:true,force:true});}
});
