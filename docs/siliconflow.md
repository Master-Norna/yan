# 在言中使用硅基流动

[← 文档目录](README.md) · [English](en/siliconflow.md)

图文完整版见硅基流动官方文档：[在言中使用硅基流动](https://docs.siliconflow.cn/docs/usercases/use-siliconcloud-in-yan)。这里只留三步：

1. 在硅基流动的 [API 密钥](https://cloud.siliconflow.cn/account/ak) 页新建一个密钥并复制。
2. 言里「设置 → 模型 → ＋ 接入模型」，接口选第一项「硅基流动」，地址自动填好（国际站账号改成 `https://api.siliconflow.com/v1`）。
3. 粘贴 Key，点「获取列表」挑一个模型（只列对话模型）；接口没有返回列表时，也可手填模型 ID。最后点「测试连接」。

思考深度在对话框的模型菜单里调，各模型该送什么参数言自会换算，见[模型接入说明](models.md)。要让模型联网、读写文件，须选支持工具调用的模型（以所选模型的能力说明为准）；不支持的，在它的「高级配置」里关掉「本机联网与文档工具」，当纯聊天模型用。
