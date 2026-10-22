import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBuildVersion } from './build-version.mjs';
test('canonical manifest supplies semantic version; missing standalone version never guesses',()=>{
 const root=mkdtempSync(join(tmpdir(),'discstudio-version-')),app=join(root,'vendor/discstudio/disc');mkdirSync(app,{recursive:true});
 assert.throws(()=>readBuildVersion(app,''),/Canonical nctk version/);
 writeFileSync(join(root,'version.json'),JSON.stringify({x:6,y:4,z:0}));assert.equal(readBuildVersion(app,'').version,'6.4.0');
 const explicit=join(root,'other-version.json');writeFileSync(explicit,JSON.stringify({x:12,y:7,z:3}));assert.equal(readBuildVersion(app,explicit).version,'12.7.3');
 writeFileSync(explicit,JSON.stringify({x:-1,y:7,z:3}));assert.throws(()=>readBuildVersion(app,explicit),/non-negative/);
});
test('recomposition invalidates version and build-mode changes, then reuses the identical request',async()=>{
 const {cpSync,readFileSync}=await import('node:fs');const {execFileSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');const path=await import('node:path');
 const here=path.dirname(fileURLToPath(import.meta.url)),root=mkdtempSync(join(tmpdir(),'discstudio-recompose-version-')),app=join(root,'vendor/discstudio/disc'),manifest=join(root,'version.json');
 mkdirSync(app,{recursive:true});cpSync(here,app,{recursive:true,filter:source=>!source.slice(here.length).split(path.sep).some(p=>['node_modules','dist','mvp-output','evidence','candidate-evidence','renders','renders-real'].includes(p))});
 cpSync(join(here,'../part-first-kernel'),join(root,'vendor/discstudio/part-first-kernel'),{recursive:true});writeFileSync(manifest,JSON.stringify({x:6,y:4,z:0}));
 const desired=join(root,'desired.json');writeFileSync(desired,execFileSync(process.execPath,['kompoze-resolve.mjs'],{cwd:app}));
 const invoke=mode=>JSON.parse(execFileSync(process.execPath,['crisp-recompose.mjs',desired],{cwd:app,encoding:'utf8',env:{...process.env,NCTK_VERSION_MANIFEST:manifest,DISCSTUDIO_LOCAL_CANDIDATE:mode}}));
 const first=invoke('1');assert.equal(first.outcome,'EXTEND');assert.equal(invoke('1').outcome,'REUSE');
 writeFileSync(manifest,JSON.stringify({x:6,y:4,z:1}));const versionChanged=invoke('1');assert.equal(versionChanged.outcome,'EXTEND');assert.notEqual(versionChanged.sourceId,first.sourceId);assert.notEqual(versionChanged.buildId,first.buildId);assert.equal(invoke('1').outcome,'REUSE');
 const modeChanged=invoke('0');assert.equal(modeChanged.outcome,'EXTEND');assert.notEqual(modeChanged.sourceId,versionChanged.sourceId);assert.notEqual(modeChanged.buildId,versionChanged.buildId);assert.equal(invoke('0').outcome,'REUSE');
 const info=JSON.parse(readFileSync(join(app,'dist/BUILD_INFO.json')));assert.equal(info.version,'6.4.1');assert.equal(info.localCandidate,false);
});
