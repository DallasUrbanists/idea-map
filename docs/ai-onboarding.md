# Getting started with AI tools

You can use an AI assistant to help with Idea Map, but you don't need one to
contribute. The [contributor guide](../CONTRIBUTING.md) works either way.

## 1. Choose a tool

Follow your tool's setup guide to install it and sign in. Check its pricing and
usage limits before you start.

| Tool | Setup guide | Open the project |
| --- | --- | --- |
| Codex | [Codex quickstart](https://learn.chatgpt.com/docs/cli) | Run `codex` from the repository folder. |
| Claude Code | [Claude Code quickstart](https://code.claude.com/docs/en/quickstart) | Run `claude` from the repository folder. |
| GitHub Copilot | [Copilot quickstart](https://docs.github.com/en/copilot/get-started/quickstart-for-using-github-copilot-in-your-ide) | Open the repository folder in your editor, then open Copilot Chat. |

Using VS Code? Install your chosen AI extension and follow its sign-in steps.
VS Code is the editor; the extension provides the AI assistant.

Other tools are welcome too. Follow their setup instructions and use the same
steps below.

## 2. Help it understand the project

Open the top-level repository folder—the one containing
[AGENTS.md](../AGENTS.md). This file points to the project's instructions.

Start with a question that doesn't change anything:

> Read AGENTS.md and the guides it links to. Tell me which files you read,
> what checks a documentation change needs, and how to protect private data.
> Don't edit files or run setup or test commands.

Compare the answer with the files and check the tool's listed sources. If it
missed a guide, attach that file or ask it to read it, then try again.
The wiki explains [how to check each tool's instructions](https://github.com/DallasUrbanists/idea-map/wiki/AI-Assisted-Development#check-which-instructions-are-loaded).

## 3. Make a small change

Choose a small issue and ask the assistant to explain its approach before editing.
Review its proposed commands and changes, and make sure you understand them.
Keep credentials and private data out of prompts.

Follow [CONTRIBUTING.md](../CONTRIBUTING.md) to run the appropriate checks and open
a pull request.

For tool settings, instruction loading, and troubleshooting, see
[AI-assisted development in the wiki](https://github.com/DallasUrbanists/idea-map/wiki/AI-Assisted-Development).
