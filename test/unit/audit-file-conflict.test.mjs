import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import createWork from "../../server/work/index.js";
test("旧指纹不能重建被删除的文件；批量替换不无限膨胀", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),"yan-conflict-"));
  const work = createWork({archiveHome:()=>root,workHome:()=>root,toolEnv:env=>env});
  const server = http.createServer((req,res)=>work.routes[`POST ${req.url}`](req,res));
  try {
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const post = async (op, args) => {const r=await fetch(`http://127.0.0.1:${server.address().port}/api/work/${op}`,{method:"POST",body:JSON.stringify({workdir:root,path:"a.txt",...args})});return {status:r.status,...await r.json()};};
    const file=path.join(root,"a.txt");
    fs.writeFileSync(file,"old");
    const {sig}=await post("read",{});
    fs.unlinkSync(file);
    const stale=await post("write",{content:"new",seen:sig});
    assert.equal(stale.stale,true); assert.equal(stale.missing,true); assert.equal(fs.existsSync(file),false);
    fs.writeFileSync(file,"x".repeat(40000));
    assert.notEqual((await post("edit",{old:"x",new:"a".repeat(1000),replaceAll:true})).status,200);
    assert.equal(fs.statSync(file).size,40000);
    assert.equal((await post("edit",{old:"x",new:"y",replaceAll:true})).status,200);
  } finally {if(server.listening)await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
});
