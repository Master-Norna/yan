// 言 · 录（记忆）与旧谈：都在浏览器里完成，不经桥接，也不需确认——每一步都在行迹里显示，记忆在设置页可改可删。
// remember 只给主模型：记忆一类一份，写的是那一类改后的全文；按本答读到的版本核对（见 11-memory.js）。
// 查旧谈、读旧谈常给：翻的是自己的对话，与记忆开不开无关
const CONVERSATION_MESSAGE_CHARS = 1500; // read_conversation 每条消息最多给这么多字
defineTool({
  name: "remember",
  group: "memory",
  label: t("记入"),
  offer: ctx => memoryOn(ctx.conversation),
  mainOnly: true,
  sideEffect: true,
  async run(step, args, { memory, memoryUpdates, conversation }) {
    const category = cleanMemoryCategory(args.category);
    step.title = category;
    if (!memoryOn(conversation)) return { ok: false, content: "记忆已关闭，没有写入。", display: "未写入" };
    if (!memory) return { ok: false, content: "本答未带入记忆，没有写入。", display: "未写入" };
    const item = memoryOf(category),
      stamp = memoryStamp(item);
    if ((memory.get(category) || "") !== stamp) {
      memoryUpdates?.set(category, stamp);
      return {
        ok: false,
        content: `「${category}」在本答读入后已变化，没有写入。请以以下最新内容为基础重新修改：\n${item ? item.text : "（此类已删去）"}`,
        display: "记忆已变化"
      };
    }
    const did = writeMemory(category, args.text);
    memoryUpdates?.set(category, memoryStamp(memoryOf(category)));
    if (did) {
      notePendingMemory(category);
      saveStore();
      // 本页的版本核对挡不住别的浏览器：真落盘时若那边也改过这一类，磁盘上的留作正本，把最新正文交回重写
      // （见 01-store/20-config.js 的 mergeMemoryItems）。写不成（桥接不在、超时）时没有冲突可报，照旧算写下了
      await flushConfig();
      const clash = takeMemoryClash(category);
      if (clash !== null) {
        memoryUpdates?.set(category, memoryStamp(memoryOf(category)));
        refreshMemorySettings();
        return {
          ok: false,
          content: `「${category}」在别处改过，没有写入。请以以下最新内容为基础重新修改：\n${clash || "（此类已删去）"}`,
          display: "记忆已变化"
        };
      }
    }
    refreshMemorySettings();
    if (did === "delete") return { ok: true, content: t`已删去「${category}」`, display: "删去" };
    if (!did) return { ok: true, content: t`「${category}」没有变`, display: "未变" };
    return { ok: true, content: `已写入「${category}」\n${memoryOf(category).text}`, display: did === "add" ? "新起" : "" };
  }
});

// 翻记忆、忘却已撤（记忆整份带在系统提示里；删一类即 remember 写空）：只留画法，旧对话的行迹里那几步照样有名字
defineTool({ name: "recall", group: "memory", label: t("翻记忆"), offer: false });
defineTool({ name: "forget", group: "memory", label: t("忘却"), offer: false });

// 查旧谈：同一工作目录的执事对话排在前面，其余按新近
defineTool({
  name: "search_conversations",
  group: "memory",
  label: t("查旧谈"),
  lookup: true,
  parallel: true,
  sources: step => (step.results || []).map(hit => ({ talk: hit.conversationId, title: hit.title, date: hit.date })),
  // 不给关键词即按时间列最近的几段（同 Claude 的 recent_chats）：「上回我们说到哪了」不必先猜一个词
  run(step, args, { conversation }) {
    const terms = keywordTerms(args.query);
    step.title = String(args.query || "").trim() || t("最近的对话");
    const limit = clampNumber(Number(args.limit), 8, 1, 20),
      sameRepo = c => isWork(conversation) && isWork(c) && c.workdir === conversation.workdir,
      hits = [];
    for (const c of [...store.conversations].sort(
      (a, b) => Number(sameRepo(b)) - Number(sameRepo(a)) || String(b.updatedAt).localeCompare(String(a.updatedAt))
    )) {
      if (c.id === conversation.id) continue;
      const lines = c.messages.filter(m => (m.role === "user" || m.role === "assistant") && m.content);
      if (terms.length && !hitsAll(`${c.title}\n${lines.map(m => m.content).join("\n")}`, terms)) continue;
      // 片段：命中的那一句前后；列最近的则取头一问的开头
      const hit = terms.length ? lines.find(m => m.content.toLowerCase().includes(terms[0])) : lines.find(m => m.role === "user"),
        text = String(hit?.content || "").replace(/\s+/g, " ");
      const at = terms.length ? Math.max(0, text.toLowerCase().indexOf(terms[0]) - 40) : 0,
        snippet = text ? `${at ? "…" : ""}${text.slice(at, at + 120)}${at + 120 < text.length ? "…" : ""}` : "";
      hits.push({
        id: c.id,
        title: c.title,
        date: String(c.updatedAt || c.createdAt).slice(0, 10),
        count: lines.length,
        snippet,
        repo: isWork(c) ? (sameRepo(c) ? t("同一目录") : t`执事：${c.workdir}`) : ""
      });
      if (hits.length >= limit) break;
    }
    step.results = hits.map(hit => ({ title: hit.title, snippet: hit.snippet, conversationId: hit.id, date: hit.date }));
    return {
      ok: true,
      content: hits.length
        ? hits
            .map(
              hit =>
                t`[${hit.id}] ${hit.date}「${hit.title}」共 ${hit.count} 条${hit.repo ? `（${hit.repo}）` : ""}${hit.snippet ? `\n  ${hit.snippet}` : ""}`
            )
            .join("\n")
        : t("此前的对话里没有命中"),
      display: `${hits.length} 段`
    };
  }
});

defineTool({
  name: "read_conversation",
  group: "memory",
  label: t("翻旧谈"),
  lookup: true,
  parallel: true,
  sources: step => (step.conversationId ? [{ talk: step.conversationId, title: step.title, date: step.date, read: true }] : []),
  run(step, args, { conversation }) {
    const c = store.conversations.find(item => item.id === args.id);
    step.title = c ? c.title : args.id;
    if (!c) return { ok: false, content: t("没有这段对话，id 以 search_conversations 的结果为准"), display: "未找到" };
    step.conversationId = c.id;
    step.date = c.updatedAt || c.createdAt;
    if (c.id === conversation.id) return { ok: false, content: t("这是当前对话，无需读取"), display: "当前对话" };
    const lines = c.messages.filter(m => (m.role === "user" || m.role === "assistant") && (m.content || m.attachments?.length));
    const offset = Math.max(1, Number(args.offset) || 1),
      limit = clampNumber(Number(args.limit), 40, 1, 100),
      slice = lines.slice(offset - 1, offset - 1 + limit);
    const body = slice
      .map((m, i) => {
        const text = String(m.content || t("（附件）")).trim();
        return `${offset + i}. 【${m.role === "user" ? t("用户") : t("助手")}】${text.length > CONVERSATION_MESSAGE_CHARS ? `${text.slice(0, CONVERSATION_MESSAGE_CHARS)}…` : text}`;
      })
      .join("\n\n");
    const end = offset - 1 + slice.length;
    return {
      ok: true,
      content: t`「${c.title}」${String(c.createdAt).slice(0, 10)}${isWork(c) ? t` · 执事：${c.workdir}` : ""}，共 ${lines.length} 条，此为第 ${offset}–${end} 条${end < lines.length ? t`；后面还有 ${lines.length - end} 条` : ""}\n\n${body || t("（这段对话没有正文）")}`,
      display: `${slice.length} 条`
    };
  }
});
