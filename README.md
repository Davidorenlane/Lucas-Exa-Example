# HOA Management Company Contact Finder (Localhost)

A one-page TypeScript app focused on one use case:

- Enter a request like: `Give me contacts for proprietors of homeowners association management companies in Florida`
- The app runs an Exa Webset search + Enrichments
- You get structured rows with contact fields and CSV export

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

## Notes

- Jobs/results are in-memory only. Restarting the server clears job history.
- Enrichment quality depends on public web data availability.
