# debate-mcp

让两个不同的 AI 模型互相辩论，由第三个模型担任裁判，给出深度分析结论。

可嵌入 Claude Desktop、Cursor 等任何支持 MCP 的 AI 工具中使用。

## 它能做什么

在你的 AI 工具里说「帮我用辩论分析一下 XXX」，就会触发：

1. **模型 A 和模型 B** 独立从不同角度分析问题
2. **裁判模型** 评估双方观点，判断是否达成共识
3. 多轮交锋后输出**共识结论**或**结构化分歧分析**

## 安装

**前置条件：** 需要安装 [Node.js](https://nodejs.org/)（版本 18 以上）

```bash
git clone https://github.com/你的用户名/debate-mcp.git
cd debate-mcp
npm install
npm run build
```

## 配置

### 1. 准备 API Key

你需要为三个角色各准备一个 API Key：

| 角色 | 默认模型 | 需要的 Key |
|------|---------|-----------|
| Agent A | DeepSeek | `DEEPSEEK_API_KEY` |
| Agent B | Doubao (ARK) | `ARK_API_KEY` |
| 裁判 | DeepSeek | `DEEPSEEK_API_KEY` |

你也可以换成其他模型（见下方高级配置）。

### 2. 配置 Claude Desktop

打开 Claude Desktop 的配置文件：
- Mac：`~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows：`%APPDATA%\Claude\claude_desktop_config.json`

添加以下内容：

```json
{
  "mcpServers": {
    "debate": {
      "command": "node",
      "args": ["/你的路径/debate-mcp/dist/index.js"],
      "env": {
        "DEEPSEEK_API_KEY": "你的 DeepSeek Key",
        "ARK_API_KEY": "你的 ARK Key"
      }
    }
  }
}
```

将 `/你的路径/debate-mcp` 替换为你实际的项目路径。

### 3. 重启 Claude Desktop

重启后即可使用。

## 使用方法

在 Claude Desktop 中直接说：

- 「帮我用辩论分析一下：远程工作对生产力的影响」
- 「用 debate 分析：先做 MVP 还是先打磨产品质量」
- 「辩论分析：量子计算 5 年内能商用吗，最多辩论 2 轮」

## 高级配置：换用其他模型

通过环境变量可以自由配置每个角色使用的模型：

```json
"env": {
  "AGENT_A_PROVIDER": "anthropic",
  "AGENT_A_MODEL": "claude-opus-4-7",
  "ANTHROPIC_API_KEY": "你的 Anthropic Key",

  "AGENT_B_PROVIDER": "openai",
  "AGENT_B_MODEL": "gpt-4o",
  "OPENAI_API_KEY": "你的 OpenAI Key",

  "JUDGE_PROVIDER": "deepseek",
  "JUDGE_MODEL": "deepseek-chat",
  "DEEPSEEK_API_KEY": "你的 DeepSeek Key"
}
```

支持的 provider：`deepseek` | `openai` | `anthropic` | `ark` | `aihubmix`

## 项目结构

```
src/
├── index.ts        # MCP server 入口
├── orchestrator.ts # 多轮辩论编排逻辑
├── prompts.ts      # Agent 和裁判的 prompt
├── llm.ts          # LLM API 调用（支持多个 provider）
└── types.ts        # 类型定义
```
