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
    description: "向接口发 HTTP 请求（调 API、看原始响应），返回状态码、响应头与正文；读网页用 fetch_page。",
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

  // 计算：在浏览器里的隔离沙箱（沙箱 iframe 里的 Worker）跑，没有网络、文件与页面
  run_js: {
    description:
      "在隔离的 JS 沙箱里跑一段代码（算术统计、日期、正则、JSON 与文本变换），返回 return 的值与 console 输出；心算易错的交给它。无网络与文件。",
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
    description: "把网上的文件下载到工作目录（最大 64 MB）。",
    brief: "把网上的文件下载进卷宗（最大 64 MB）。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        path: { type: "string", description: "相对工作目录；给目录或省略则按网址里的文件名存" }
      },
      required: ["url"]
    }
  },

  // 纲：长活的结论图（见 src/19-graph/），计划卡的升级；只给主模型。标 claimed 即另请验的人判
  update_graph: {
    description:
      "长活（不止三五步）可立一张纲给用户看：拆成几项要成立的结论，各写怎么算成立、以哪几项为前提；没有谁以之为前提的是根。一项是值得单独验的结论（「配置写错时报错带行号」），不是一步动作。每次只给有改动的几项，已有的只给 id 与要改的字段。标 claimed 即请验的人照 check 判，成立以判词为准；说法一改回到未做，前提改了、或验后相关文件又被改，已成立的转为待复验。动过纲的这一答，收尾前会查根立住没有。",

    parameters: {
      type: "object",
      properties: {
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "短名" },
              claim: { type: "string", description: "要成立的那句话" },
              check: { type: "string", description: "怎么算成立：验的人照它判，可写要跑的检验、要看的现象" },
              needs: { type: "array", items: { type: "string" }, description: "前提的 id" },
              when: { type: "string", description: "只在某一情形下需要成立时写明情形；分情况的几项各写一个，同为上一项的前提" },
              any: { type: "boolean", description: "true：前提里一项成立即可（几条路线择一）" },
              status: { type: "string", description: "open / doing / claimed / dropped" },
              evidence: { type: "string", description: "标 claimed 时交的证据：改了什么、怎么验过、看哪里" },
              files: { type: "array", items: { type: "string" } }
            },
            required: ["id"]
          }
        }
      },
      required: ["nodes"]
    }
  },

  // 验的人交判词：只给验的人（见 src/19-graph/10-check.js）
  verdict: {
    description: "交判词，交了即可收工。",
    parameters: {
      type: "object",
      properties: {
        holds: { type: "boolean", description: "照验收，这一项是否成立" },
        gap: { type: "string", description: "不成立时差在哪、怎么看出来的，写到做的人照着能补" },
        files: { type: "array", items: { type: "string" }, description: "判它所凭的文件：日后它们再改，这一项就得重验" }
      },
      required: ["holds"]
    }
  },

  run_command: {
    description: "在工作目录执行一条非交互式指令，返回退出码、stdout 与 stderr。",
    brief: "在卷宗目录执行一条非交互式指令（生成文件、检查本机），返回退出码与输出。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的指令" },
        timeout: { type: "number", description: "超时秒数，默认 120，不设上限" },
        background: {
          type: "boolean",
          description:
            "要跑一阵的（开发服务器、长任务）放后台：先回几秒输出与编号，结束时结果作为一条消息送到。要过一阵再做的事，也可挂一条先等待的后台指令"
        }
      },
      required: ["command"]
    }
  },

  check_command: {
    description: "看后台指令（run_command 的 background）上次之后的新输出；stop 为 true 则结束它。",
    brief: "看后台指令的新输出；stop 为 true 则结束它。",
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
    description: "精确替换文件中的一段：old 须与文件逐字一致（含缩进）且只出现一次，从 read_file 的结果复制（去掉行号）。",
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
    description: "列文件树：目录以 / 结尾，文件后跟字节数。给 pattern 时按 glob 找文件。",
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
        path: { type: "string", description: "只在此子目录或文件里找" },
        glob: { type: "string", description: "只找匹配的文件，如 *.py" },
        literal: { type: "boolean", description: "按原文而非正则匹配" },
        limit: { type: "number", description: "最多返回几条，默认 60，最大 200" }
      },
      required: ["query"]
    }
  },

  delegate: {
    description:
      "差遣一名帮手独立完成一件自成一段的子任务，做完回报。宜于量大、独立、或会读进大量与主线无关内容的活（通读归纳、多路检索比对、排查不熟的模块、按已定方案实现一部分、改后复查）；一两步的事直接做。帮手的目录与工具同你（请示用户、记与忘除外），但看不到这段对话，task 须写全。能拆成互不相干的几块时，可同一轮差遣多名并行（所改文件互不重叠）。",
    brief:
      "把一件自成一段的大活（通读一批资料并归纳、多路检索比对、生成一份复杂文件）交给帮手独立做完后回报；一两步的事直接做。帮手看不到这段对话，task 须写全。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "四到十个字的任务名，用于显示" },
        task: { type: "string", description: "给帮手的完整任务说明：背景、要做什么、不该动什么、完成的标准、回报要包含什么" },
        effort: {
          type: "string",
          enum: ["low", "medium", "high", "max"],
          description:
            "帮手的思考强度，按活的难易定：照章办事（通读归纳、批量检索、按已定方案改）取最低档，要权衡取舍的取居中，难查的毛病、方案设计与复查取最高档；省略同你此刻"
        }
      },
      required: ["title", "task"]
    }
  },

  helper: {
    description:
      "给帮手递话。正做着的，话在它说到落点时读到（补充、改向）；已收工的即续派，它带着先前的经过接着做，同样回报。stop 叫停正做着的，它已做的随后送到。",
    parameters: {
      type: "object",
      properties: {
        helper: { type: "string", description: "差遣时起的任务名" },
        message: { type: "string", description: "要递的话或续派的活" },
        stop: { type: "boolean", description: "true 即叫停" }
      },
      required: ["helper"]
    }
  },

  // 请示：下一步取决于用户的选择时弹一张小表单；对谈与执事都提供，在浏览器里完成
  ask_user: {
    description:
      "拿不准时可弹一张小表单请用户选（范围、风格、方案取舍、缺关键信息、需求有歧义），答案显然的不必问。1–8 题，常 1–3；用户亦可自填。",
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
      "记一条长期有效的信息进跨对话的记忆（偏好、身份、约定、日后还会用到的结论）：一条一事、脱离本次对话也看得懂；临时细节不记；已有相近条目给 replaces 合并。",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "所属分类，先沿用已有的类，都不合再起新类；名字简短，如「偏好」「言的开发」" },
        text: { type: "string", description: "条目正文，写全，不超过 2000 字" },
        replaces: { type: "string", description: "要合并更新的已有条目 id（见 recall 的结果）" }
      },
      required: ["category", "text"]
    }
  },

  forget: {
    description: "删除一条过时或有误的记忆。",
    parameters: { type: "object", properties: { id: { type: "string", description: "recall 结果里的条目 id" } }, required: ["id"] }
  },

  recall: {
    description:
      "查看记忆：都不给则列出各类（几条、最近一条的开头）；给 category 列出那一类的全部条目；给 query 跨类按关键词筛（空格分隔、须同时命中）。用户提到此前谈过的事、或问题依赖过往偏好时用。",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "分类名，可省略" },
        query: { type: "string", description: "关键词，可省略" }
      }
    }
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
    description:
      "读对话附件或卷宗里的文档（PDF、Office、文本），全文或片段；长文档按页码或关键词只取片段。{{docs}}卷宗里有什么不清楚时，name 留空即列出。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "文件名或卷宗里的路径，可部分匹配；留空即列出可读的文档" },
        page: { type: "integer", description: "只读取该页（PDF / PPTX）" },
        query: { type: "string", description: "只返回包含该关键词的段落" }
      }
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
