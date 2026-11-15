"use strict";
// 模型上游的共同出口：对话、列模型与生图只给地址、鉴权和请求体，出站标记在这里加。
// 标记随重定向保留；本机模型照常可用，但上游不能借转发调回言自己的受信接口。
const { OUTBOUND_MARK } = require("../web.js");
module.exports = function fetchUpstream(url, options = {}) {
  return fetch(url, { ...options, headers: { ...options.headers, [OUTBOUND_MARK]: "1" } });
};
