import test from "node:test";
import assert from "node:assert/strict";
import sse from "../../server/model/sse.js";
test("无换行超长模型事件被拒绝而不是无限缓冲",async()=>{
  const encoder=new TextEncoder();
  const input=new ReadableStream({start(c){c.enqueue(encoder.encode("data: "+"x".repeat(32*1024*1024)));c.close();}});
  const output=await new Response(input.pipeThrough(sse.translateSse("test",()=>assert.fail("unexpected event")))).text();
  assert.match(output,/单个模型事件超过大小限制/);
});
test("正常分块的 JSON 仍能转换",async()=>{
  const encoder=new TextEncoder();
  const input=new ReadableStream({start(c){c.enqueue(encoder.encode('data: {"a":'));c.enqueue(encoder.encode('1}\n\n'));c.close();}});
  const output=await new Response(input.pipeThrough(sse.translateSse("test",(out,data)=>{assert.equal(data.a,1);out.done();}))).text();
  assert.match(output,/\[DONE\]/);
});
