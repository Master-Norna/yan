// 言 · 内置提示词 · 工具定义
// 交给模型的 function 定义（OpenAI tools 格式里 function 的 description 与参数），按工具名与 src/15-tools/ 的登记对上。
// 模型是把系统提示和这一整份一起读的：每件工具做什么、何时用、有什么不能猜的规矩，只在这里说一遍，系统提示不复述。
// 哪件工具在何处给出（桥接在不在、绑没绑目录、记忆开没开）、帮手与旁注能不能用，都写在登记里，这里只管说法。
// 带 brief 的在言（对谈）里用短说明——对谈的每一问都背着这份定义，越轻越好；文白相杂、能省则省。{{docs}} 这类为运行时填入的值。
(window.YAN_PROMPTS ||= {}).tools = {
  search_web: {
    description: "联网搜索，返回若干条标题、链接与摘要。",
    parameters: { type: "object", properties: { query: { type: "string", description: "关键词，简洁具体" } }, required: ["query"] }
  },

  fetch_page: {
    description: "读网页正文（已去 HTML），多用于看某条搜索结果的详情。",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] }
  },

  http_request: {
    description:
      "向接口发一个 HTTP 请求（GET / POST / PUT / PATCH / DELETE / HEAD），返回状态码、响应头与正文（过长截断）。读网页用 fetch_page；这件用于调 API、看原始响应，本机 127.0.0.1 亦可，别的内网地址不可。",
    brief: "向接口发 HTTP 请求（调 API、看原始响应），返回状态码、响应头与正文；读网页用 fetch_page。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
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
      "在隔离的 JS 沙箱里跑一段代码：算术统计、单位换算、日期（new Date() 即当前时刻）、正则、JSON 与文本变换、排序去重——心算易错的都交给它。只有标准 JS，无网络、文件与页面。单个表达式直接写；多条语句用 return 交回，console.log 亦一并返回。",
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
      "把网上的文件下载到工作目录（图片、PDF、压缩包、数据文件……最大 64 MB）。path 相对工作目录；给目录或省略则按网址里的文件名存。本机 127.0.0.1 可，别的内网地址不可。",
    brief: "把网上的文件下载进卷宗（最大 64 MB）；path 省略则按网址里的文件名存。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        path: { type: "string", description: "相对工作目录；省略则按网址里的文件名" }
      },
      required: ["url"]
    }
  },

  // 计划：行里给用户看的任务清单，每次给完整清单；只给主模型
  update_plan: {
    description:
      "任务不止三五步时先把计划列给用户看，过程中随时更新；每次给完整清单（非增量），不多于十条。状态：pending / doing（同时至多一项）/ done / skipped（text 里说明为何）。一两步的小事不必用。",
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
    description: "在工作目录执行一条非交互式指令（不等输入、不开编辑器或图形界面），返回退出码、stdout 与 stderr。",
    brief: "在卷宗目录执行一条非交互式指令（生成文件、检查本机），返回退出码与输出。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的指令" },
        timeout: { type: "number", description: "超时秒数，默认 120，不设上限；耗时长的指令记得给足" },
        background: {
          type: "boolean",
          description: "开发服务器、监听构建这类不会自己结束的放后台：先回几秒输出与编号，之后用 check_command"
        }
      },
      required: ["command"]
    }
  },

  check_command: {
    description: "看后台指令（run_command 的 background）：取上次之后的新输出，可先等几秒；stop 为 true 则结束它。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "后台指令的编号，如 bg1" },
        wait: { type: "number", description: "最多等几秒再取（等到结束或输出停下），默认 0" },
        stop: { type: "boolean", description: "结束这条后台指令" }
      },
      required: ["id"]
    }
  },

  write_file: {
    description: "新建文件，或整份重写已有文件（覆盖全部内容），目录自动创建。改局部用 edit_file。",
    brief: "写一个文本文件（新建或整份覆盖），目录自动创建。",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "相对工作目录" }, content: { type: "string" } },
      required: ["path", "content"]
    }
  },

  edit_file: {
    description:
      "精确替换文件中的一段：old 须与文件逐字一致（含缩进）且只出现一次，从 read_file 的结果复制（去掉行号）。本段对话里没读过的文件不能编辑。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相对工作目录" },
        old: { type: "string", description: "原文" },
        new: { type: "string" },
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
      "差遣一名帮手独立完成一件自成一段的子任务，做完回报。宜于量大、独立、或会读进大量与主线无关内容的活：通读一批文件并归纳、多路检索比对、在不熟的模块里排查、按已定方案实现互不相干的一部分、改后独立复查；一两步的事直接做。帮手的目录与工具同你（请示用户、记与忘除外），但看不到这段对话：task 里写全背景、目标、边界、完成标准与回报内容。活能拆成互不相干的几块时，同一轮差遣多名并行（所改文件互不重叠），差遣前一句话说拆法。",
    brief:
      "把一件自成一段的大活（通读一批资料并归纳、多路检索比对、生成一份复杂文件）交给帮手另起一段对话独立做完后回报。帮手看不到这段对话：task 里写全背景、目标、边界与回报内容。一两步的事直接做。",
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
      "拿不准便先弹一张小表单请用户选，再动手——范围、风格、交付形式、方案取舍、缺关键信息、需求有歧义；答案显然者不问。1–8 题（常 1–3），每题 2–4 个短选项，可并存者 multi: true；用户亦可自填。得到答复后照做，不复述。",
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
      "记一句长期有效的信息进跨对话的记忆（偏好、身份、约定、日后还会用到的结论）：一句话、脱离本次对话也看得懂；临时细节不记；已有相近条目给 replaces 合并。",
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
    parameters: { type: "object", properties: { id: { type: "string", description: "recall 结果里的条目 id" } }, required: ["id"] }
  },

  recall: {
    description: "查看记忆：给 query 按关键词筛（空格分隔、须同时命中），不给则返回全部。用户提到此前谈过的事、或问题依赖过往偏好时用。",
    parameters: { type: "object", properties: { query: { type: "string", description: "关键词，可省略" } } }
  },

  search_conversations: {
    description: "按关键词查旧对话（标题与正文，须同时命中），返回对话 id、标题、日期与命中片段；追溯记忆里没有的细节时用。",
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
    description: "读对话附件或卷宗里的文档，全文或片段。可读文档：{{docs}}。长文档按页码或关键词只取片段。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "文件名，可部分匹配" },
        page: { type: "integer", description: "只读取该页（PDF / PPTX）" },
        query: { type: "string", description: "只返回包含该关键词的段落" }
      },
      required: ["name"]
    }
  },

  // MCP 里工具多、定义重的服务按需给：模型只见目录，用时先查参数、再调用。{{directory}} 是各服务的目录
  mcp_describe: {
    description: "查 MCP 工具的说明与参数，调用前先查；可一次查几件。已接入、按需取用的服务与工具：\n{{directory}}",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "服务名，见目录" },
        tools: { type: "array", items: { type: "string" }, description: "要查的工具名" }
      },
      required: ["server", "tools"]
    }
  },

  mcp_call: {
    description: "调用一件 MCP 工具（服务与工具见 mcp_describe 的目录），params 照查得的参数给。",
    parameters: {
      type: "object",
      properties: {
        server: { type: "string", description: "服务名" },
        tool: { type: "string", description: "工具名" },
        params: { type: "object", description: "那件工具的参数" }
      },
      required: ["server", "tool"]
    }
  }
};
