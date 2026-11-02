# Work with an AI assistant

AI tools can help you explore Idea Map and make changes to it. If you choose to
use one, this guide helps you set it up and check its work. AI assistance is
optional, and you're responsible for understanding and reviewing the changes
you contribute.

The [agent operating guide](../../AGENTS.md) contains the shared rules for agents.
You can use it to check that your assistant is following project instructions.

The following contents links navigate within this guide:

- [Choose an AI tool](#choose-an-ai-tool)
- [Load project instructions](#load-project-instructions)
- [Make a small assisted change](#make-a-small-assisted-change)

## Choose an AI tool

You should follow your tool's setup guide to install it and sign in.

| Tool | Setup guide | Open the project |
| --- | --- | --- |
| Codex | [Codex quickstart](https://learn.chatgpt.com/docs/cli) | Run `codex` from the repository folder. |
| Claude Code | [Claude Code quickstart](https://code.claude.com/docs/en/quickstart) | Run `claude` from the repository folder. |
| GitHub Copilot | [Copilot quickstart](https://docs.github.com/en/copilot/get-started/quickstart-for-using-github-copilot-in-your-ide) | Open the repository folder in your editor, then open Copilot Chat. |

If you use Visual Studio Code, you should install your chosen AI extension and
follow its sign-in steps. Visual Studio Code is the editor; the extension
provides the AI assistant.

You can use other tools by following their setup instructions and the
project-instruction steps in the following sections.

## Load project instructions

You should open the top-level repository folder—the one containing
[AGENTS.md](../../AGENTS.md). This file contains the shared operating rules and
links to the guides agents need for their tasks.

You should begin with a read-only request to the agent:

> You must read `AGENTS.md` and the guides it requires for a documentation task.
> Report which files you read, what checks a documentation change needs, and how
> to protect private data. Do not edit files or run setup or test commands.

You should compare the answer with the files and check the tool's listed
sources. If it missed a guide, attach that file or ask it to read it, then try
again. The wiki explains
[how to check each tool's instructions](https://github.com/DallasUrbanists/idea-map/wiki/AI-Assisted-Development#check-which-instructions-are-loaded).

## Make a small assisted change

You should
[choose a small issue on GitHub](https://github.com/DallasUrbanists/idea-map/issues)
and ask the assistant to explain its approach before editing. Review its
commands and changes, and make sure you understand them. Keep credentials and
private data out of prompts.

You should follow [CONTRIBUTING.md](../../CONTRIBUTING.md) to run the
appropriate checks and open a pull request.

You can find tool settings, instruction loading, and troubleshooting in
[AI-assisted development in the wiki](https://github.com/DallasUrbanists/idea-map/wiki/AI-Assisted-Development).
