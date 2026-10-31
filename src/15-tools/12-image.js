// 言 · 生图：专司里配好了生图的模型才交出这件工具（只给主模型）。图由桥接取回成 data: 地址（见 server/model/image.js），
// 收进这段对话的目录根（言里是卷宗，行里是工作目录）；原件另作附件挂在这一步上，步骤卡画缩略、正文引文件名就地画出（见 renderReplyShots）；
// 交回轮次循环随工具结果附给模型，能看图的自己核对合不合意（看不了的换成一句话，见 attachToolImages）
defineTool({
  name: "generate_image",
  group: "image",
  label: t("生图"),
  busy: t("作画中"),
  mainOnly: true,
  // 一轮要几稿就几件一起画；落盘是独占写（见 server/work/archive.js 的 placeFree），同名的各自让开
  parallel: true,
  offer: ctx => ctx.files && dutyReady(store.settings.dutyImage),
  sideEffect: true,
  writes: true,
  async run(step, args, { conversation, signal }) {
    const text = String(args.prompt || "").trim();
    step.title = text.replace(/\s+/g, " ").slice(0, 60);
    step.note = text;
    const { images } = await bridge(
      "/api/image",
      { profile: profileForRequest(store.settings.dutyImage), prompt: text, size: args.size },
      signal
    );
    noteUsage("image", images.length);
    const { data, revised } = images[0],
      mime = data.slice(5, data.indexOf(";")),
      base =
        String(args.name || "")
          .replace(/\.(png|jpe?g|webp|gif)$/i, "")
          .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
          .trim() || `图-${step.id.slice(-6)}`,
      // 不走 putArchiveFile：那是人放进卷宗的记法，记了答末的成品条就不列它
      saved = await bridgeUpload(
        "/api/archive/put",
        { root: workRoot(conversation), name: `${base}.${mime.split("/")[1]?.replace("jpeg", "jpg") || "png"}` },
        dataUrlBlob(data),
        signal
      ),
      meta = { id: uid(), kind: /** @type {const} */ ("image"), name: saved.name, mime, size: saved.size, modifiedAt: Date.now() };
    await putAttachment({ ...meta, data }).catch(() => {});
    step.attachments = [meta];
    step.title = saved.path;
    noteToolWrite(conversation, saved.path);
    return {
      ok: true,
      content:
        prompt("image.saved", { path: saved.path, name: saved.name }) + (revised ? `\n${prompt("image.revised", { text: revised })}` : ""),
      display: "",
      images: [data]
    };
  }
});
