// 言 · 内置提示词 · 工具定义
// 交给模型的 function 定义（OpenAI tools 格式里 function 的 description 与 parameters）。
// 模型是把系统提示和这一整份一起读的：每件工具做什么、何时用、有什么不能猜的规矩，只在这里说一遍，系统提示不复述。
// search_web / fetch_page / http_request 在桥接在线时提供；run_js 一律提供（在浏览器里的隔离沙箱跑，直连也有）；六件文件工具在桥接在线时提供（绑了目录落在工作目录，没绑落在卷宗），
// download_file 随之；update_plan 只给行的主模型；delegate 在桥接在线且有别的工具可交给帮手时提供（帮手自己不再差遣）；
// ask_user 对谈与执事都提供（帮手没有）；五件记忆工具在记忆启用时提供（帮手只有 recall / search_conversations / read_conversation，不能 remember / forget）；read_document 在对话带有可读文档时提供。
// 言（对谈）里工具只为产出文件，不带 edit_file / search_files，且带 brief 的工具用 brief 代替 description——对谈的每一问都背着这份定义，越轻越好。
// 参数在页面上按这里的 schema 核对：必填项缺了不执行；有副作用的工具（run_command / write_file / edit_file / remember / forget / delegate）参数 JSON 被截断时也不执行。
(window.YAN_PROMPTS ||= {}).tools = {
  search_web: {
    description: "联网搜索，返回若干条标题、链接与摘要。",
    parameters: { type: "object", properties: { query: { type: "string", description: "关键词，简洁具体" } }, required: ["query"] }
  },

  fetch_page: {
    description: "读取网页正文（已去 HTML），通常用于查看某条搜索结果的详情。",
    parameters: { type: "object", properties: { url: { type: "string", description: "完整的 http/https 地址" } }, required: ["url"] }
  },

  http_request: {
    description:
      "向公网接口发一个 HTTP 请求（GET / POST / PUT / PATCH / DELETE / HEAD），返回状态码、响应头与正文（文本或 JSON，过长截断）。读普通网页用 fetch_page；这件用于调 API、看原始响应。不能访问本机与内网地址。",
    brief: "向公网接口发 HTTP 请求（调 API、看原始响应），返回状态码、响应头与正文；读网页用 fetch_page。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "完整的 http/https 地址" },
        method: { type: "string", description: "GET（默认）/ POST / PUT / PATCH / DELETE / HEAD" },
        headers: { type: "object", description: '请求头，如 { "Accept": "application/json" }' },
        body: { type: "string", description: "请求体原文（JSON 请自行序列化并给 Content-Type）" }
      },
      required: ["url"]
    }
  },

  // 计算：在浏览器里的隔离沙箱（沙箱 iframe 里的 Worker）跑，没有网络、文件与页面；直连没桥接时也有
  run_js: {
    description:
      "在隔离的 JavaScript 沙箱里跑一段代码做计算与数据处理：算术与统计、单位换算、日期与时间（new Date() 即当前时间）、正则、JSON 与文本变换、排序去重——凡是心算容易错的都交给它。只有标准 JS，没有网络、文件与页面。单个表达式直接写；多条语句用 return 交回结果，console.log 的输出也一并返回。",
    brief: "在隔离的 JS 沙箱里跑一段代码（算术、日期、正则、JSON 变换），返回 return 的值与 console 输出；心算易错的交给它。",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript 代码：单个表达式，或带 return 的多条语句" },
        timeout: { type: "number", description: "超时秒数，默认 10，最大 60" }
      },
      required: ["code"]
    }
  },

  download_file: {
    description:
      "把网上的文件下载到工作目录里（图片、PDF、压缩包、数据文件……最大 64 MB）。path 是相对工作目录的文件路径；给目录或省略则按网址里的文件名存。不能访问本机与内网地址。",
    brief: "把网上的文件下载进卷宗（最大 64 MB）；path 省略则按网址里的文件名存。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "完整的 http/https 地址" },
        path: { type: "string", description: "存成的文件路径，相对工作目录；省略则按网址里的文件名" }
      },
      required: ["url"]
    }
  },

  // 计划：行里给用户看的任务清单，每次给完整清单；只给主模型
  update_plan: {
    description:
      "任务不止三五步时，先把计划列给用户看，做的过程中随时更新各项状态；每次给出完整的清单（不是增量），项目不宜多于十条。状态：pending（待做）、doing（正在做，同时至多一项）、done（做完）、skipped（不做了，text 里说明为何）。一两步的小事不必用。",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "一句话说明这一项" },
              status: { type: "string", description: "pending / doing / done / skipped" }
            },
            required: ["text", "status"]
          }
        }
      },
      required: ["items"]
    }
  },

  run_command: {
    description: "在工作目录执行一条非交互式指令，返回退出码、stdout 与 stderr。",
    brief: "在卷宗目录执行一条非交互式指令（生成文件用），返回退出码与输出。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的指令" },
        timeout: { type: "number", description: "超时秒数，默认 120，最大 600；耗时长的指令记得给" }
      },
      required: ["command"]
    }
  },

  write_file: {
    description: "新建文件，或整份重写已有文件（覆盖全部内容），目录自动创建。改局部用 edit_file。",
    brief: "写一个文本文件（新建或整份覆盖），目录自动创建。",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "相对工作目录的路径" }, content: { type: "string", description: "文件全文" } },
      required: ["path", "content"]
    }
  },

  edit_file: {
    description:
      "把文件中的一段文本精确替换：old 须与文件逐字一致（含缩进）且只出现一次，从 read_file 的结果复制（去掉行号）。本段对话里没读过的文件不能编辑。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对工作目录的路径" },
        old: { type: "string", description: "要被替换的原文" },
        new: { type: "string", description: "替换后的文本" },
        replace_all: { type: "boolean", description: "old 出现多处时全部替换，默认 false" }
      },
      required: ["path", "old", "new"]
    }
  },

  read_file: {
    description: "读取文本文件，带行号；大文件用 offset / limit 分段。",
    brief: "读文本文件，带行号；大文件用 offset / limit 分段。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "number", description: "起始行，从 1 开始" },
        limit: { type: "number", description: "读取行数，默认 400" }
      },
      required: ["path"]
    }
  },

  list_files: {
    description: "列文件树：目录以 / 结尾，文件后跟字节数，链接以 @ 结尾（不跟进）。给 pattern 时按 glob 找文件。",
    brief: "列卷宗里的文件（目录以 / 结尾，文件后跟字节数）；给 pattern 时按 glob 找。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对路径，默认为工作目录本身" },
        depth: { type: "number", description: "层级，默认 2，最大 8" },
        pattern: { type: "string", description: "glob，如 *.ts、src/**/*.js" }
      }
    }
  },

  search_files: {
    description: "按正则在文本文件里逐行检索，返回 文件:行号:内容；跳过 node_modules、.git 等。定位代码用它。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "正则（默认不区分大小写）" },
        path: { type: "string", description: "只在此子目录里找" },
        glob: { type: "string", description: "只找匹配的文件，如 *.py" },
        literal: { type: "boolean", description: "按原文而非正则匹配" },
        limit: { type: "number", description: "最多返回几条，默认 60，最大 200" }
      },
      required: ["query"]
    }
  },

  delegate: {
    description:
      "差遣一名帮手独立完成一件自成一段的子任务，做完回报给你。该用就用：通读一批文件并归纳、多路检索比对、在某个不熟的模块里排查一个问题、按已定方案实现互不相干的一部分、改完后独立验证复查——凡是量大、独立、或会读入大量与主线无关内容的活，先想差遣再想自己做；一两步的事直接做。帮手有与你相同的工具与工作目录，但看不到这段对话：task 里要写全背景、目标、边界、完成标准与要回报的内容。同一轮里可差遣多名帮手并行，分派时让他们改的文件互不重叠。",
    brief:
      "把一件自成一段的大活（通读一批资料并归纳、多路检索比对、生成一份复杂文件）交给帮手另起一段对话独立做完后回报。帮手工具与你相同但看不到这段对话：task 里写全背景、目标、边界与要回报的内容。一两步的事直接做。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "四到十个字的任务名，用于显示" },
        task: { type: "string", description: "给帮手的完整任务说明：背景、要做什么、不该动什么、完成的标准、回报要包含什么" }
      },
      required: ["title", "task"]
    }
  },

  // 请示：下一步取决于用户的选择时弹一张小表单；对谈与执事都提供，在浏览器里完成
  ask_user: {
    description:
      "下一步取决于用户的选择时（几种做法各有取舍、缺信息、需求有歧义）弹一张小表单请用户选，比在正文里连问省事。1–8 题（通常 1–3），每题给 2–4 个简短选项，可并存的选择给 multi: true；用户也可自填。得到答复后直接继续，不复述选择。",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "完整的问句" },
              header: { type: "string", description: "两三个字的短标签" },
              options: {
                type: "array",
                items: { type: "string" },
                description: "2–4 个简短选项；要附说明写成「选项 — 说明」"
              },
              multi: { type: "boolean", description: "可多选时给 true" }
            },
            required: ["question", "options"]
          }
        }
      },
      required: ["questions"]
    }
  },

  // 录（记忆）：五件都在浏览器里完成，不经桥接；记忆启用时提供
  remember: {
    description:
      "记一句长期有效的信息进跨对话的记忆（偏好、身份、约定、日后还会用到的结论）：一句话、脱离本次对话也能看懂；临时细节不记；已有相近条目给 replaces 合并。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "一句话，不超过 200 字" },
        replaces: { type: "string", description: "要合并更新的已有条目 id（见 recall 的结果）" }
      },
      required: ["text"]
    }
  },

  forget: {
    description: "删除一条过时或有误的记忆。",
    parameters: { type: "object", properties: { id: { type: "string", description: "条目 id（见 recall 的结果）" } }, required: ["id"] }
  },

  recall: {
    description: "查看记忆：给 query 按关键词筛（空格分隔、须同时命中），不给则返回全部。用户提到此前谈过的事、或问题依赖过往偏好时用。",
    parameters: { type: "object", properties: { query: { type: "string", description: "关键词，可省略" } } }
  },

  search_conversations: {
    description: "按关键词在旧对话里查找（标题与正文，须同时命中），返回对话 id、标题、日期与命中片段；追溯记忆里没有的细节时用。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "关键词，以空格分开" },
        limit: { type: "number", description: "最多返回几段，默认 8，最大 20" }
      },
      required: ["query"]
    }
  },

  read_conversation: {
    description: "读一段旧对话的主线（长消息会截断），可用 offset / limit 分段；id 来自 search_conversations。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "对话 id" },
        offset: { type: "number", description: "起始条数，从 1 开始" },
        limit: { type: "number", description: "读取条数，默认 40，最大 100" }
      },
      required: ["id"]
    }
  },

  read_document: {
    description: "读对话附件或卷宗里的文档全文或片段。可读文档：{{docs}}。长文档按页码或关键词只取片段。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "文件名，可部分匹配" },
        page: { type: "integer", description: "只读取该页（PDF / PPTX）" },
        query: { type: "string", description: "只返回包含该关键词的段落" }
      },
      required: ["name"]
    }
  }
};
