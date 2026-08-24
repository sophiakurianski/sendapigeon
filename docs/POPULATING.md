# Populating a SendAPigeon vault

Hand this file to the agent doing the loading, along with the sources. It
assumes the agent can either call the `pigeon_*` MCP tools or run `pigeon` in a
shell — the two are equivalent, so use whichever you have.

## Before anything else

Read `AGENTS.md` in the vault for the record format and the pipeline stages.
Then run `pigeon_stats` (or `pigeon --json stats`) to see what is already there.
A vault that already has records is being *added to*, not filled from scratch,
and the rules below about duplicates matter much more.

Set your actor on every write:

    pigeon --actor <your-name> ...        # CLI
    PIGEON_ACTOR=<your-name> pigeon mcp   # MCP

Everything you write lands in `data/activity.jsonl` under that name, so a bad
run can be found and reversed. Do not write as `cli` or `web`.

## Do not invent anything

A CRM with invented data is worse than an empty one, because someone will act
on it — email the wrong address, call the wrong number, greet the wrong title.

- Record only what the source actually says.
- Leave a field out rather than guessing it. Every field except `name`/`title`
  is optional.
- Never infer an email address from a name and a domain. `j.doe@acme.com` is a
  guess, and a guess that looks exactly like a fact.
- Put anything uncertain in prose — the note body or `--description` — where it
  reads as context, not as a verified field. "Mei mentioned a CFO named Sam,
  surname unclear" belongs in a note, not in `people.jsonl`.

## Check before you create

Ids are slugs, so "Acme Corp" and "Acme Corporation" become two separate
companies that will never join back up. Before creating anything:

    pigeon --json search "acme"

Search covers every record type and the full text of notes. If something close
already exists, update it instead of adding a second one:

    pigeon company set acme-corp --industry Logistics

People and deals accept a company by **name**, and reuse the existing company
when the name matches. So once `Acme Corp` exists, this attaches rather than
duplicates:

    pigeon person add "Jane Doe" --company "Acme Corp" --email jane@acme.com

That matching is exact-ish — it compares id, name, domain and slug. "Acme" and
"Acme Corp" will *not* match, so settle on one name per company early and use it
consistently for the whole run.

## Order of work

Companies do not have to come first — adding a person or deal with `--company`
creates the company on the fly. But going top-down gives better records,
because the company gets its real fields instead of just a name:

1. **Companies** — name, domain, industry, location.
2. **People** — under their company, with title, email, phone.
3. **Deals** — with company, contacts, value, stage, expected close.
4. **Todos** — attached to the deal, person or company they belong to.
5. **Notes** — meeting notes last, linked to the deal and its attendees.

## Bulk data: import, do not loop

If the source is already a table — a CSV export, a spreadsheet, a database
dump — do **not** create records one at a time. Convert it to CSV and import:

    pigeon import people contacts.csv
    pigeon import companies accounts.csv
    pigeon import deals pipeline.csv

Column names are matched loosely, so a Pipedrive or HubSpot export usually goes
in untouched: `Organization`, `Job Title`, `Email Address`, `First Name` /
`Last Name`, `Labels`, `Deal Value`, `Close Date` are all understood. Companies
referenced by name are created automatically.

Import reports what happened; rows with no usable name are skipped rather than
half-written:

    { "created": 42, "skipped": 1, "errors": [] }

Use the per-record tools only for sources that are genuinely unstructured —
email threads, meeting transcripts, a page of handwritten notes.

## Notes

Meeting notes are the one place to be generous with prose. Write real markdown,
link it to the deal and the people who were there:

    pigeon note new "Northwind discovery" \
      --deal northwind-fleet-rollout \
      --person "Mei Tan" --person "Sam Okafor" \
      --date 2026-08-19 \
      --file /tmp/note.md

Pass `--date` when the meeting happened on a day other than today — the file is
named after that date and that is how it sorts.

For anything long, write the markdown to a file and use `--file`, or pipe it in
with `--file -`. Body text on the command line gets mangled by the shell.

To add to a note that already exists, append rather than rewriting it:

    pigeon note append 2026-08-19-northwind-discovery "- Legal came back clean"

## Deals

A deal needs a stage. Read the real stage ids from `pigeon --json config`
rather than assuming the defaults — the pipeline is editable, and a wrong stage
is rejected with `BAD_STAGE` and the list of valid ones.

    pigeon deal add "Fleet rollout" --company "Northwind Freight" \
      --value 145000 --stage demo --person mei-tan --close "+6w"

- `--value` is a plain number. The currency comes from the vault config.
- `--close` accepts `2026-10-06`, `friday`, `+6w`, `next month`.
- Already-closed deals: create them, then `pigeon deal win <id>` or
  `pigeon deal lose <id> --reason "..."`. Do not leave a signed deal sitting in
  `negotiation`.

## Todos

Attach every todo to something. An unattached todo is a reminder, not CRM data.

    pigeon todo add "Send revised proposal" --deal acme-renewal --due friday --priority high

A todo on a deal inherits that deal's company automatically. Dates accept
`today`, `tomorrow`, `friday`, `+3d`, `+2w`, or `YYYY-MM-DD`. If the source
gives no date, leave it off — an invented due date creates false urgency.

## When you are done

    pigeon --json stats
    pigeon board
    pigeon --json activity --limit 50

Report back: how many of each record you created, anything you skipped and why,
and any place you had to make a judgement call. Flag every guess you made so a
human can check it.

## If something goes wrong

The vault is plain text. `data/activity.jsonl` shows every change with its
actor and timestamp, so a bad run is traceable line by line. Records can be
deleted with `pigeon <kind> rm <id>`, and notes are just files you can delete.
Nothing here is a one-way door — but tell the human what happened rather than
quietly patching over it.
