# SendAPigeon

A lightweight, agent-first CRM. People, companies, deals, todos and meeting
notes, stored as plain files you own — one JSON record per line and markdown
notes in a folder, like an Obsidian vault.

> **Pre-1.0:** SendAPigeon is usable today, but its APIs and file format may
> still evolve. Back up a vault before upgrading or importing important data.

It is headless first. The CLI, the MCP server and the REST API all drive the
same core, so you can point a coding agent or Hermes at it and it can actually
do things. The web UI is a view onto the same files, not the source of truth.

```
pigeon deal add "Acme renewal" --company "Acme Corp" --value 24000 --stage proposal
pigeon todo add "Send revised proposal" --deal acme-renewal --due friday
pigeon board
```

## Install

```bash
npm install
npm run build          # compiles the CLI/server/MCP and bundles the web UI
npm link               # puts `pigeon` on your PATH (optional)
```

Node 20 or newer.

## Start a vault

```bash
pigeon init ~/SendAPigeon
```

That creates the folder, records it in `~/.sendapigeonrc`, and writes an
`AGENTS.md` inside it describing the format to whatever agent you point at it.

Every command resolves the vault in this order: `--vault`, then `$PIGEON_VAULT`,
then a `.sendapigeon` folder found by walking up from the working directory,
then `~/.sendapigeonrc`, then `~/SendAPigeon`. Committing a `.sendapigeon`
folder into a repo gives that repo its own CRM.

## Give SendAPigeon to your agent

After `pigeon init`, the vault contains an `AGENTS.md` written specifically for
agents. It explains the records, relationships, available commands and rules
for making safe changes. Give an agent access in three steps:

1. Point the agent at your vault folder, or add the vault to its workspace.
2. Tell it to read `AGENTS.md` before touching CRM data.
3. Give it either the `pigeon` CLI on its `PATH` or the MCP server described in
   [Agents](#agents). MCP is the easiest option for agents that support tools;
   the CLI works with any coding agent that can use a shell.

You can paste this as the agent's first instruction:

```text
Use SendAPigeon as my CRM. Read the AGENTS.md in the vault first. Use the
pigeon MCP tools or the pigeon CLI for all writes so activity is recorded.
Start by showing me the current stats, overdue todos and people board. Before
creating a duplicate person or company, search for an existing record. Record
your name as the actor on every change.
```

For a shell-only agent, launch it with the vault location and actor name:

```bash
PIGEON_VAULT=~/SendAPigeon PIGEON_ACTOR=my-agent your-agent-command
```

For a repo-specific CRM, initialise `.sendapigeon` in the repository. Agents
working in that repository will discover it automatically. The project
`.gitignore` excludes this folder; do not commit a real vault or its contact
data to a public repository.

```bash
pigeon init .sendapigeon
```

Run `pigeon agents` at any time to print the generated agent instructions.

## Multiple vaults

Vaults can live in completely different folders and never share records. In
the web UI, click **Current loft** at the bottom of the sidebar to open the
vault manager. From there you can:

- switch between remembered vaults;
- create a clean vault in a new folder;
- open an existing SendAPigeon vault folder; or
- forget a vault without deleting its folder or data.

The selected vault becomes the default for the CLI and MCP server as well. You
can still target a specific folder explicitly with `--vault` or
`PIGEON_VAULT`.

## What is on disk

```
SendAPigeon/
  pigeon.json                  pipeline stages, currency
  data/companies.jsonl         one company per line
  data/people.jsonl            people, linked by companyId
  data/deals.jsonl             deals, linked by companyId and personIds
  data/todos.jsonl             todos, linked by dealId / personId / companyId
  data/activity.jsonl          append-only log of every change and who made it
  notes/2026-08-24-acme-kickoff.md
  AGENTS.md                    how to drive this vault
```

A record is one line of JSON:

```json
{"id":"jane-doe","name":"Jane Doe","companyId":"acme-corp","title":"Head of Ops","email":"jane@acme.com","createdAt":"2026-08-24T04:31:06.337Z","updatedAt":"2026-08-24T04:31:06.337Z"}
```

A note is markdown with YAML frontmatter, readable by Obsidian as-is:

```markdown
---
id: 2026-08-24-acme-kickoff
title: Acme kickoff
date: '2026-08-24'
type: meeting
companyId: acme-corp
dealId: acme-renewal
attendees:
  - jane-doe
---

## Agenda
- Pricing for FY27
```

Creates append a line. Updates and deletes rewrite the file atomically. Fields
the schema does not know about are preserved, so you can add your own and
nothing will strip them.

**Ids are readable slugs** derived from the name or title, and almost every
command accepts a plain name instead: `pigeon deal show "Acme renewal"` works as
well as `pigeon deal show acme-renewal`.

## CLI

Add `--json` to any command for machine-readable output, and `--actor <name>` so
the activity log records who did it.

```bash
pigeon company add "Acme Corp" --domain acme.com --tags target,enterprise
pigeon person  add "Jane Doe" --company "Acme Corp" --email jane@acme.com --title "Head of Ops"
pigeon deal    add "Acme renewal" --company "Acme Corp" --value 24000 --stage proposal --person jane-doe
pigeon todo    add "Send proposal" --deal acme-renewal --due friday --priority high
pigeon note    new "Acme kickoff" --deal acme-renewal --person jane-doe --file notes.md

pigeon board                       # the kanban, in the terminal
pigeon deal mv acme-renewal negotiation
pigeon deal win acme-renewal
pigeon todo done send-proposal
pigeon note append 2026-08-24-acme-kickoff "- Follow up on pricing"

pigeon search "pricing"            # everything, note bodies included
pigeon stats                       # pipeline and workload
pigeon activity                    # who changed what
pigeon where                       # which vault am I talking to
```

`ls`, `show`, `set` and `rm` exist for every record type. `--field key=value`
sets anything the flags do not cover. Dates accept `2026-09-01`, `today`,
`tomorrow`, `friday`, `+3d`, `+2w`.

## Agents

### MCP

```bash
pigeon mcp     # stdio MCP server, 35 tools over the same core
```

Register it with any MCP client:

```json
{
  "mcpServers": {
    "sendapigeon": {
      "command": "pigeon",
      "args": ["mcp"],
      "env": { "PIGEON_VAULT": "~/SendAPigeon", "PIGEON_ACTOR": "hermes" }
    }
  }
}
```

Tools mirror the CLI — `pigeon_board`, `pigeon_create_deal`, `pigeon_move_deal`,
`pigeon_create_note`, `pigeon_append_note`, `pigeon_list_todos` and so on — and
every one returns JSON. Start an agent on `pigeon_stats` or `pigeon_board` to
orient it.

### Shell

An agent with only a shell needs no integration at all:

```bash
pigeon --json board
pigeon --json todo ls --overdue
pigeon --actor hermes deal mv acme-renewal demo
```

### Files

Or skip the tooling and read `data/*.jsonl` and `notes/*.md` directly. Writing
through the CLI or MCP is preferred only because it keeps `activity.jsonl`
honest.

## Web UI and REST

```bash
pigeon serve --open        # http://127.0.0.1:4477
```

The local server has no authentication and intentionally binds to
`127.0.0.1`. Do not bind it to a public interface or expose it directly to the
internet. See the [security policy](SECURITY.md) before deploying it anywhere
other than your own machine.

Drag deals between stages, work the todo list, read notes. Every deal card
carries a postmark showing how many days it has sat in its current stage — it
inks up as the deal goes stale, so a stuck pipeline is visible before you read a
word.

The JSON API is on the same port:

| Method | Path | |
|---|---|---|
| `GET` `POST` | `/api/vaults` | list or create vaults |
| `POST` | `/api/vaults/{open,switch}` | open or switch folder-backed vaults |
| `DELETE` | `/api/vaults` | forget a vault without deleting its files |
| `GET` | `/api/board` | kanban, grouped by stage |
| `GET` | `/api/stats` | pipeline and workload summary |
| `GET` | `/api/search?q=` | across every record and note body |
| `GET` `POST` | `/api/{companies,people,deals,todos,notes}` | list, create |
| `GET` `PATCH` `DELETE` | `/api/{…}/:id` | read expanded, update, delete |
| `POST` | `/api/deals/:id/{move,win,lose,reopen}` | pipeline actions |
| `POST` | `/api/todos/:id/toggle` | complete or reopen |
| `POST` | `/api/notes/:id/append` | append markdown |
| `GET` | `/api/export/:table?format=csv` | csv, json or jsonl |
| `POST` | `/api/import/:table` | csv or json rows |
| `GET` | `/api/activity` | change log |

Send `x-pigeon-actor: <name>` and your agent shows up by name in the log.

## Getting data in and out

Nothing here is a lock-in format, and export is a first-class command rather
than a settings page.

```bash
pigeon export deals --format csv -o deals.csv
pigeon export all --format json -o backup.json     # every record plus note bodies
pigeon import people pipedrive-contacts.csv        # loose column matching
```

Import matches column names loosely, so a Pipedrive or HubSpot export usually
lands without remapping: `Organization`, `Job Title`, `Email Address` and
friends are all understood, and companies referenced by name are created.

## Development

```bash
npm run dev          # API on :4477 against your default vault
npm run dev:web      # Vite on :4478, proxying /api to :4477
npm test             # 48 tests over the core, the file format and the REST API
npm run typecheck
```

Layout: `src/core` is the whole model and has no idea the others exist;
`src/cli`, `src/server` and `src/mcp` are three thin adapters over it; `web/` is
the React UI.

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request, follow the [Code of Conduct](CODE_OF_CONDUCT.md), and
report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Licence

SendAPigeon is open-source software under the [MIT License](LICENSE). You may
use, modify, self-host and redistribute it, including commercially.

This follows a model similar to Sanity's open-source Studio and CLI: the local
product stays permissively licensed, while an optional managed SendAPigeon
service may be offered separately. A hosted service can charge for convenience
and cloud-only capabilities such as managed sync, authentication, teams,
backups and operations. MIT also permits other people to fork the project or
offer competing hosting; it does not grant an exclusive right to the SaaS
market.
