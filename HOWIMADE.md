# How I Made This

## Prompt-driven build summary

This project was built iteratively from your prompts, with each step changing scope and architecture:

1. **Initial prompt**
   - You asked for a simple localhost TypeScript app to source HOA leads with Exa.
   - We scaffolded a one-page app (`Express + TypeScript + static frontend`) with:
     - Exa search form
     - configurable search options
     - configurable output fields
     - in-memory results + CSV export

2. **Contact-focused direction**
   - You clarified the real goal: find **manager/proprietor contacts** (phone, LinkedIn, etc.).
   - We updated defaults and UI text to bias toward contact extraction.
   - We clarified that plain Exa search is useful for discovery, but structured contact extraction is better served by **Websets + Enrichments**.

3. **Full rebuild for core use case**
   - You asked to redo the whole thing around this use case.
   - We replaced the original search-first flow with an async **job workflow**:
     - `POST /api/jobs`: create Webset search + enrichments
     - poll status via `GET /api/jobs/:id`
     - load rows via `GET /api/jobs/:id/results`
     - export CSV via `GET /api/jobs/:id/export.csv`
   - Backend now waits for Webset completion, fetches items, maps enrichment outputs into structured rows, dedupes, and stores in memory.

4. **Reliability fixes from runtime feedback**
   - You reported it looked stuck.
   - We diagnosed that it was not only latency; polling had `500` errors.
   - We added safer async route handling and centralized error logging in the server to make backend failures explicit.

5. **Final business correction**
   - You corrected the target from HOA associations to **HOA management companies**.
   - We updated the schema, enrichments, defaults, and docs accordingly.

## Current output model (from your latest prompt)

The CSV now targets management-company leads with fields like:

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

## Why this architecture was chosen

- **Websets + Enrichments** matches your requirement for structured contacts better than raw search results.
- **Async jobs + polling** fits long-running enrichment tasks.
- **In-memory + CSV** matches your MVP requirement (no persistent DB complexity).

## Scope changes captured from your prompts

- generic HOA lead sourcing -> contact-focused HOA leads -> full contact-enrichment tool -> HOA management company proprietor contacts with employee count.
