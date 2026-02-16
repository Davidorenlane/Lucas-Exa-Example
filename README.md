# HOA Management Company Contact Finder (Localhost)

A one-page TypeScript app focused on one use case:

- Enter a request like: `Give me contacts for proprietors of homeowners association management companies in Florida`
- The app runs an Exa Webset search + Enrichments
- You get structured rows with contact fields and CSV export

## Request example

Use this format in the UI:

`Give me a list of contacts for the proprietors of homeowners association management companies in Florida, including their name, LinkedIn, email, phone number, HOA manager phone number, website, contact page, and number of employees at their company.`

## Output columns

- `management_company_name`
- `management_company_website`
- `management_company_employee_count`
- `proprietor_name`
- `proprietor_title`
- `proprietor_linkedin`
- `proprietor_email`
- `proprietor_phone`
- `hoa_manager_phone`
- `contact_page_url`
- `source_url`
- `source_description`
- `webset_item_id`

## How it works

1. `POST /api/jobs` creates a Webset with a contact-focused query and enrichments.
2. The server waits for the Webset to become idle.
3. The server fetches Webset items, flattens enrichment results into lead rows, dedupes, and stores in memory.
4. UI polls job status and loads rows when complete.
5. CSV export is available at `GET /api/jobs/:id/export.csv`.

## API endpoints

- `GET /api/config`: UI defaults and column metadata
- `GET /api/jobs`: list existing in-memory jobs
- `POST /api/jobs`: create a new enrichment job
- `GET /api/jobs/:id`: get status for one job
- `GET /api/jobs/:id/results`: get structured rows for completed job
- `GET /api/jobs/:id/export.csv`: download CSV for completed job

## Runtime expectations

- Typical runtime for small jobs (`count=10`) is around `30s` to `3m`.
- Larger jobs can take several minutes depending on web availability and enrichment complexity.
- Job polling continues until status is `completed` or `failed`.

## Limits and behavior

- `count` is clamped to `10..1000`.
- Webset wait timeout is `20 minutes` in the server.
- Results are deduped before CSV export.
- Jobs/results are in-memory only.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` and set your Exa key:

```bash
cp .env.example .env
```

3. Edit `.env`:

```bash
EXA_API_KEY=YOUR_KEY_HERE
PORT=3000
```

## Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For production-style run:

```bash
npm run build
npm start
```

## Troubleshooting

- `500` while polling (`/api/jobs/:id`):
  - Check the server terminal output first; the backend logs route + error details.
  - Common causes are upstream API failures or malformed request values.
- CSV confirm/download error like `database is locked (5)`:
  - Use direct export URL instead: `http://localhost:3000/api/jobs/<JOB_ID>/export.csv`
  - Or terminal download:
    - `curl -o hoa-contacts.csv "http://localhost:3000/api/jobs/<JOB_ID>/export.csv"`
- Empty or partial contact fields:
  - Expected when public web data is missing for a company/contact.
  - Try a narrower query (region/submarket) or smaller batches.

## Notes

- Restarting the server clears job history.
- Enrichment quality depends on public web data availability.
