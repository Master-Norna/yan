# Presets

[← Docs](README.md) · [中文](../presets.md)

A preset bundles a way of working into one: a prompt, which tool groups to give (web, compute, images, commands and files, documents, asking the user, memory and past chats, subagents) and which MCP servers, which model, and the command permission level. Building a specialized agent on top of Yan — connecting a project's MCP and writing a dedicated prompt — is just adding a preset.

- Add, edit and delete presets in **Settings → Presets**, one card each; changes save immediately. Built-in tool groups and MCP servers are selected separately. Selecting everything in either list also includes later additions to that list.
- Choose one from the model menu next to the input box: chats with it selected follow that set, and the model button shows the preset's name; ordinary new chats use the most recently selected preset or the preset of the chat you last opened. For a chat started within a group, an assigned group preset takes priority. Choose **None** to use Yan without a preset.
- The preset's prompt goes first in the system prompt, followed by Yan's own sections. Only the chosen tool groups are given to the model; an MCP server that isn't chosen won't run even if the model calls it by name. Selecting a preset with a model or permission level switches to those settings. Switching back to **None** removes the preset without restoring the previous model or permission level.
