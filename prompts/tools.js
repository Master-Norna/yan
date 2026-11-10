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
    description: "读网页或 PDF 正文（已去 HTML）。",
    parameters: {
      type: "object",
      properties: { url: { type: "string" }, offset: { type: "number", description: "从第几字起读，长文续读用" } },
      required: ["url"]
    }
  },

  http_request: {
    description: "向接口发 HTTP 请求（调 API、看原始响应），返回状态码、响应头与正文；读网页用 fetch_page。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", description: "默认 GET" },
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

  // 生图：专司里配了生图的模型才给
  generate_image: {
    description: "按描述画一幅图，存进工作目录根。描述写画面本身：主体、构图、风格、光色；图中要有字的写明原字。",
    brief: "按描述画一幅图，存进卷宗。描述写画面本身：主体、构图、风格、光色；图中要有字的写明原字。",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "画面描述" },
        size: { type: "string", description: "宽x高，如 1024x1024；省略由接口定" },
        name: { type: "string", description: "文件名（不带扩展名），省略自动取" }
      },
      required: ["prompt"]
    }
  },

  // 计划：行里给用户看的任务清单，每次给完整清单；只给主模型
  update_plan: {
    description:
      "任务不止三五步时可把计划列给用户看，随做随更新；每次给完整清单，不多于十条。doing 同时至多一项，skipped 在 text 里说明为何。",
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

  // 撮要：执事与帮手自己在节点上把这一答此前的往来换成笔记（见 src/14-chat-engine/60-context.js 的 foldByModel）
  fold: {
    description:
      "做完一段、此前的工具往来不必再逐字留着时可调：这一答此前的往来（连同先前的笔记）换成你写的笔记，原文此后不可见。上下文将满时言也会自动撮。",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description:
            "工作笔记，分点：查明的事实与结论（留关键的路径、行号、命令、数字）、改过的文件与现状、验证过与没验证的、走不通的路、下一步"
        }
      },
      required: ["note"]
    }
  },

  // 意：一件工程要成立的结论图，存在目录里、跨对话沿用（见 src/19-intent/）；只给主模型
  update_intent: {
    description:
      "一答做不完的长活（要分几回推进、等人拍板或等长跑的任务）可立一份意：整件工程要成立的结论图，存于目录 .yan/意.json，换对话也沿用。计划只管这一答的步骤，一答做得完的活，步数再多用计划即可。一个目录可有几件事，各立各的根；一直做下去的活（维护、例行）不立总根，界限归守，每一回各立一根。根立住那件即了结，不再附着，要接着做的到文件里找到它，把根改回 doing 或写进新一项的 needs。一项是值得单独判的结论，不是一步动作。每次只给有改动的几项，已有的只给 id 与要改的字段。",
    parameters: {
      type: "object",
      properties: {
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "短名，用对话的语言，八字以内" },
              rename: { type: "string", description: "已有一项改叫这个名字，前提与所属随之改" },
              claim: { type: "string", description: "要成立的那句话" },
              check: { type: "string", description: "怎么算成立" },
              when: { type: "string", description: "只在什么情形下须成立（文字说明，不是表达式）；空串撤去" },
              needs: { type: "array", items: { type: "string" }, description: "前提的 id，可跨模块" },
              any: { type: "boolean", description: "true：前提里一项立住即可（几条路线择一）" },
              in: { type: "string", description: "所属模块的 id：一项拆开还有许多步即作模块，细项写 in 指向它；不写即全局" },
              anchors: { type: "array", items: { type: "string" }, description: "凭据，标成立或假定后它变了即转待复核" },
              state: {
                type: "string",
                description:
                  "open / doing / waiting（等人拍板）/ done / assumed（借外部结论、不自己做）/ dropped（走过不通的路，留作记号）/ removed（方案改了、写错了，整项撤去）"
              },
              note: { type: "string", description: "假定写出处；待定写等谁、定什么；弃写为何不通" },
              root: {
                type: "boolean",
                description: "整件工程最终要立住的结论（用户要的结果，不是手上这一步），新立时标，漏了可补标；说法只照用户的意思改"
              },
              keep: {
                type: "boolean",
                description:
                  "守：一直要守住的条件，不是要交付一次的结论——用户定的界限（「只用某几台机器」），或往下做不能破的（原有测试要过、保持零依赖）。能对上某类动作的写 on 作钩子；余下能用指令验的挂 test: 或 cmd:（现成没有可写一条），动过手的那一答收尾前重查，不过即拦下。只为某一件事守的写 in 指向它，它了结即不再作数"
              },
              on: {
                type: "string",
                description:
                  "守的钩子：一条正则（不分大小写、含有即中，写窄到动作本身，如 git\\b[^;|&]*\\spush\\b 而非 push：命令名与动作之间可能夹着全局选项，如 git -C 目录 push），比将要做的那一步（指令原文、文件路径、网址或工具名），对上即动手前把关：挂了 test: 的先跑它，不过即不做（将要做的经环境变量 YAN_TOOL（工具名）、YAN_TARGET 交给它）；没挂的就不做；空串撤去"
              },
              ask: {
                type: "boolean",
                description: "true：钩子对上时请用户批，准了才做——用户留给自己拍板的关口（「发布前给我审」）；限制不标"
              }
            },
            required: ["id"]
          }
        }
      },
      required: ["nodes"]
    }
  },

  run_command: {
    description: "在工作目录执行一条非交互式指令，返回退出码、stdout 与 stderr。",
    brief: "在卷宗目录执行一条非交互式指令（生成文件、检查本机），返回退出码与输出。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的指令" },
        description: { type: "string", description: "一句白话说这条要做什么，给不看指令的用户看，如「在本地跑 codegen 的测试」" },
        timeout: { type: "number", description: "前台最多等几秒，默认 120，最多 600；到时还没结束就转入后台接着跑，不会被终止" },
        background: {
          type: "boolean",
          description: "要跑一阵的（开发服务器、长任务）放后台：先回几秒输出与编号，结束时结果作为一条消息送到"
        }
      },
      required: ["command"]
    }
  },

  check_command: {
    description: "看一条候：后台指令（bg…）上次之后的新输出，或定时（t…）几时到；stop 为 true 则结束或取消它。",
    brief: "看后台指令的新输出或定时几时到；stop 为 true 则结束或取消。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "编号，如 bg1、t1" },
        wait: { type: "number", description: "后台指令最多等几秒再取（等到结束或输出停下），默认 0" },
        stop: { type: "boolean", description: "结束这条后台指令，或取消这个定时" }
      },
      required: ["id"]
    }
  },

  set_timer: {
    description: "到点叫醒自己：at 与 after 给一个，到时 note 作为一条消息送到；every 则此后每隔这么久再叫，直到 check_command 取消。",
    brief: "到点叫醒自己：at 或 after 给一个，到时 note 作为消息送到；every 则周期再叫。",
    parameters: {
      type: "object",
      properties: {
        at: { type: "string", description: "本地时刻，如 2026-10-31 09:00；只写 09:00 即下一个这个钟点" },
        after: { type: "number", description: "多少秒后" },
        every: { type: "number", description: "此后每隔多少秒再叫" },
        note: { type: "string", description: "到时给自己的话：要做什么、看什么" }
      },
      required: ["note"]
    }
  },

  write_file: {
    description: "新建或整份覆盖一个文件，目录自动创建；改局部用 edit_file。",
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
      "差遣一名帮手独立完成一件自成一段的子任务，做完回报。宜于量大、独立、或会读进大量与主线无关内容的活（通读归纳、多路检索、排查不熟的模块、按已定方案实现、改后复查）；一两步的事直接做。帮手的目录与工具同你（请示用户、定时、记忆、计划与意除外），看不到这段对话，task 须写全。互不相干的几块可同一轮差遣多名并行（所改文件互不重叠）。",
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
            "思考强度：照章办事（通读归纳、批量检索、按已定方案改）取 low，要权衡取舍的居中，难查的毛病、方案设计与复查取 max；省略同你此刻"
        }
      },
      required: ["title", "task"]
    }
  },

  helper: {
    description:
      "给帮手递话。正做着的，话在它说到落点时读到（补充、改向）；已收工的即续派，它带着先前的经过接着做，同样回报。stop 叫停正做着的，它已做的随后送到。read 只翻它的经过（说的话、做的步骤与指令输出），核对回报时用。",
    parameters: {
      type: "object",
      properties: {
        helper: { type: "string", description: "差遣时起的任务名" },
        message: { type: "string", description: "要递的话或续派的活" },
        stop: { type: "boolean", description: "true 即叫停" },
        read: { type: "boolean", description: "true 即只翻它的经过，不递话" }
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

  // 录（记忆）与旧谈：都在浏览器里完成，不经桥接。remember 在专司配好了记忆优化时提供；查旧谈、读旧谈常给
  remember: {
    description:
      "改写跨对话记忆里的一类。记忆按类各成一份、整份在系统提示里；text 给这一类改后的全文：仍成立的照留，新的并进去，过时的、用户要忘的删去，写成离开这段对话也看得懂的话；空串即删去这一类。用户说要记、纠正了你、或透露了往后都用得上的偏好与情况时用。",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "类名：沿用已有的，都不合再起新类，名字简短" },
        text: { type: "string", description: "这一类改后的全文" }
      },
      required: ["category", "text"]
    }
  },

  search_conversations: {
    description:
      "查旧对话：给关键词按标题与正文查（须同时命中），不给则按时间列出最近的；返回对话 id、标题、日期与片段。追溯记忆里没有的细节时用。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "关键词，以空格分开；省略即列最近的" },
        limit: { type: "number", description: "最多返回几段，默认 8，最大 20" }
      }
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
      "读对话附件、卷宗里的文档（PDF、Office、文本）或技能的说明，全文或片段；长文档按页码或关键词只取片段。{{docs}}卷宗里有什么不清楚时，name 留空即列出。",
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
