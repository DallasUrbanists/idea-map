# AI tool onboarding

AI assistance is optional. You can contribute using the normal [contributor guide](../CONTRIBUTING.md) without an AI account or extension. Tools and plans may have usage limits or costs; check the provider's terms before enabling them. Never put credentials, private data or production content in prompts. Review every suggested action and diff yourself.

These instructions were checked against the linked official documentation on 2026-10-31. Interfaces and availability change; follow the current provider instructions if they differ. The project entry point is [AGENTS.md](../AGENTS.md), which links the contributor and task guidance. More specific instructions may apply below the root.

## A safe first exercise

Open a trusted checkout at its repository root. In your chosen tool, ask:

> Read the repository instructions and their linked guidance. Without changing files or running commands, identify the instruction files you used, summarize the validation and data-protection rules, and point to the relevant guide for a documentation change.

Compare the answer with `AGENTS.md`, `CONTRIBUTING.md` and `docs/agent-guidance.md`. A plausible answer alone does not prove discovery: inspect the tool's context or references where available. If a linked file is missing from context, explicitly attach or ask the tool to read it and repeat. Do not approve edits or commands for this exercise. For actual work, choose a bounded issue, inspect proposed changes and run the checks appropriate to that change. Harness-by-harness fresh-checkout verification is tracked in [#33](https://github.com/DallasUrbanists/idea-map/issues/33); this guide does not claim it has been performed.

## Codex

Follow the [official Codex quickstart](https://learn.chatgpt.com/docs/cli) to install the CLI and sign in using the offered method. Choose the checkout as the project, or start the CLI from its root with `codex`. Review the workspace and approval settings before a session. Codex discovers `AGENTS.md` along the directory path; see [instruction discovery and troubleshooting](https://developers.openai.com/codex/guides/agents-md/). Ask the read-only question above and compare the named sources with the files. If necessary, explicitly request the linked guide; do not assume a Markdown link itself loaded its target.

## Claude Code

Install using the platform-specific [official quickstart](https://code.claude.com/docs/en/quickstart), verify `claude --version`, then run `claude` from the checkout root and follow its sign-in prompts. The root [CLAUDE.md](../CLAUDE.md) points to canonical guidance. Run `/context` to inspect loaded `CLAUDE.md` and rules, then use the read-only exercise above; explicitly request linked files if needed. See [Claude Code memory and instructions](https://code.claude.com/docs/en/memory). Check permission mode before allowing changes or shell commands.

## GitHub Copilot

Follow the [Copilot IDE quickstart](https://docs.github.com/en/copilot/get-started/quickstart-for-using-github-copilot-in-your-ide) for your supported editor, account and entitlement. Open the checkout root and use Copilot Chat. Repository instructions live in [.github/copilot-instructions.md](../.github/copilot-instructions.md) and point to the canonical guidance. Use the read-only exercise and inspect the response references for instructions actually included; explicitly attach linked files when necessary. See [repository custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions).

## VS Code and other harnesses

[VS Code](https://code.visualstudio.com/docs/getstarted/overview) is an editor; it is not itself a particular AI provider or agent. Install the desired extension or select a supported harness and sign in as its provider directs. Open the repository folder, choose the intended harness, and use **Chat: Open Customizations** to inspect its available instructions. Discovery differs by harness: consult [VS Code custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions), check relevant settings and expand response References. Run the same read-only exercise; attach the canonical files explicitly if the selected harness does not discover them. Inline suggestions do not necessarily use chat instructions.

For another tool, consult its official setup and instruction-discovery documentation. Open the repository root and provide `AGENTS.md`, `CONTRIBUTING.md` and `docs/agent-guidance.md` as context manually if needed. Use the exercise above to check its understanding and verify its claimed sources yourself. Treat agent output as a proposal, and follow the project's normal review and validation process.
