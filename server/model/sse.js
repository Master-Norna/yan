"use strict";
// 言 · 别家的事件流换回 chat.completions 分块（data: {...}\n\n，末尾 [DONE]）的共用骨架：切行、拼分块、报错、收尾都在这里，
// 各家只写「一个事件换成什么」——handle(out, data, event)，event 是 event: 行报的名字（没有即 data.type）：
//   out.chunk(delta, extra?, finish?)  发一块；out.model 可改（上游在开头报了实际型号）
//   out.done()                         收尾，补 [DONE]
//   out.fail(message)                  作答途中出错：按 OpenAI 流里的报错格式交出去，页面据此按「连接中断」处理、稍候接着写，
//                                      而不是把一句报错写进正文、当这一答写完了
// done、fail 之后再来的一概不理。没等到收尾就断了：不补 [DONE]，页面按「连接中断」处理、可续写（已收到结束原因的，页面照常收尾）
function translateSse(model, handle) {
  const decoder = new TextDecoder(),
    encoder = new TextEncoder(),
    id = `chatcmpl-${Date.now().toString(36)}`;
  let buffer = "",
    event = "",
    stopped = false,
    /** @type {TransformStreamDefaultController} */ controller;
  const send = text => controller.enqueue(encoder.encode(text));
  const out = {
    model,
    chunk(delta, extra = {}, finish = null) {
      send(
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model: out.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`
      );
    },
    done() {
      stopped = true;
      send("data: [DONE]\n\n");
    },
    fail(message) {
      stopped = true;
      send(`data: ${JSON.stringify({ error: { message: `接口在作答途中出错：${message || "未知错误"}` } })}\n\n`);
    }
  };
  const feed = text => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (stopped) return;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:"))
        try {
          const data = JSON.parse(line.slice(5).trim());
          handle(out, data, event || data.type);
        } catch {}
      else if (!line) event = "";
    }
  };
  return new TransformStream({
    transform(bytes, c) {
      controller = c;
      if (!stopped) feed(decoder.decode(bytes, { stream: true }));
    },
    flush(c) {
      controller = c;
      if (!stopped) feed(`${decoder.decode()}\n`);
    }
  });
}
// 整份的 chat.completions 答复（中转不支持流式）摆成只有一块的事件流：页面只有一种读法，正文、思绪、工具调用、用量、结束原因的语义只有一份。
// finish_reason 缺失的按 stop 算（它把话说完了才收）。整份里的调用是一列，位置才算数、index 本不属于这个格式：
// 照次序编号，放在展开之后——上游自带的 index 不能盖掉位置（两件都写 index: 0 的会并成一件，参数拼成 {"x":1}{"x":2}）
/** @param {any} json */
function wholeReplyEvents(json) {
  const choice = json.choices?.[0],
    delta = { ...choice?.message };
  if (Array.isArray(delta.tool_calls)) delta.tool_calls = delta.tool_calls.map((call, index) => ({ ...call, index }));
  const block = { choices: [{ delta, finish_reason: choice?.finish_reason || "stop" }], ...(json.usage ? { usage: json.usage } : {}) };
  return `data: ${JSON.stringify(block)}\n\ndata: [DONE]\n\n`;
}
module.exports = { translateSse, wholeReplyEvents };
