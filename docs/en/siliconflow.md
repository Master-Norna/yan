# Using SiliconFlow in Yan

[← Docs](README.md) · [中文](../siliconflow.md)

The full illustrated guide is in SiliconFlow's official docs: [Using SiliconFlow in Yan](https://docs.siliconflow.cn/docs/usercases/use-siliconcloud-in-yan) (in Chinese). The three steps:

1. On SiliconFlow's [API keys](https://cloud.siliconflow.cn/account/ak) page, create a key and copy it.
2. In Yan, go to **Settings → Model → ＋ Add model** and choose the first API option, **SiliconFlow**; the address is filled in for you (for an international account, change it to `https://api.siliconflow.com/v1`).
3. Paste the key, click **Fetch list** to pick a model (only chat models are listed). If the API returns no list, you can enter the model ID manually. Then click **Test connection**.

Adjust thinking depth in the model menu next to the input box; Yan converts it into whatever parameters each model expects (see [Models and tools](models.md)). For the model to browse the web or read and write files, choose one that supports tool calls (check the capabilities of the specific model). For one that doesn't, turn off **Local web and document tools** in its **Advanced** settings and use it as a plain chat model.
