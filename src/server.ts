import cors from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import { Exa, CreateEnrichmentParametersFormat, type WebsetEnrichment, type WebsetItem } from "exa-js";
import { Parser as Json2CsvParser } from "json2csv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

type CreateJobBody = {
  request: string;
  count?: number;
};

type JobStatus = "pending" | "running" | "completed" | "failed";

type ContactLeadRow = {
  management_company_name: string;
  management_company_website: string;
  management_company_employee_count: string;
  proprietor_name: string;
  proprietor_title: string;
  proprietor_linkedin: string;
  proprietor_email: string;
  proprietor_phone: string;
  hoa_manager_phone: string;
  contact_page_url: string;
  source_url: string;
  source_description: string;
  webset_item_id: string;
};

type ContactJob = {
  id: string;
  request: string;
  count: number;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  websetId?: string;
  websetTitle?: string;
  rowCount: number;
  rows: ContactLeadRow[];
};

type EnrichmentDefinition = {
  key: keyof ContactLeadRow;
  description: string;
  format: CreateEnrichmentParametersFormat;
};

const app = express();
const port = Number(process.env.PORT ?? 3000);

const jobs = new Map<string, ContactJob>();

const ENRICHMENTS: EnrichmentDefinition[] = [
  {
    key: "proprietor_name",
    description:
      "Primary proprietor/owner full name for this homeowners association management company.",
    format: CreateEnrichmentParametersFormat.text
  },
  {
    key: "proprietor_title",
    description:
      "Role/title of that person (proprietor, owner, principal, or equivalent leadership role).",
    format: CreateEnrichmentParametersFormat.text
  },
  {
    key: "proprietor_linkedin",
    description: "LinkedIn profile URL for that proprietor/owner.",
    format: CreateEnrichmentParametersFormat.url
  },
  {
    key: "proprietor_email",
    description: "Best public email address for that proprietor/owner.",
    format: CreateEnrichmentParametersFormat.email
  },
  {
    key: "proprietor_phone",
    description: "Best public direct phone number for that proprietor/owner.",
    format: CreateEnrichmentParametersFormat.phone
  },
  {
    key: "hoa_manager_phone",
    description: "Primary public phone number for the HOA manager or management company office.",
    format: CreateEnrichmentParametersFormat.phone
  },
  {
    key: "management_company_website",
    description: "Official website URL for this homeowners association management company.",
    format: CreateEnrichmentParametersFormat.url
  },
  {
    key: "contact_page_url",
    description: "Direct contact page URL for the management company.",
    format: CreateEnrichmentParametersFormat.url
  },
  {
    key: "management_company_employee_count",
    description: "Estimated number of employees at this management company.",
    format: CreateEnrichmentParametersFormat.number
  }
];

const CSV_COLUMNS: (keyof ContactLeadRow)[] = [
  "management_company_name",
  "management_company_website",
  "management_company_employee_count",
  "proprietor_name",
  "proprietor_title",
  "proprietor_linkedin",
  "proprietor_email",
  "proprietor_phone",
  "hoa_manager_phone",
  "contact_page_url",
  "source_url",
  "source_description",
  "webset_item_id"
];

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/config", (_req: Request, res: Response) => {
  res.json({
    defaults: {
      request:
        "Give me a list of contacts for the proprietors of homeowners association management companies in Florida, including their name, LinkedIn, email, phone number, HOA manager phone number, website, contact page, and number of employees at their company.",
      count: 250
    },
    csvColumns: CSV_COLUMNS,
    enrichmentKeys: ENRICHMENTS.map((item) => item.key)
  });
});

app.get("/api/jobs", route(async (_req: Request, res: Response) => {
  const allJobs = [...jobs.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((job) => summarizeJob(job));

  res.json({ jobs: allJobs });
}));

app.post("/api/jobs", route(async (req: Request<{}, {}, CreateJobBody>, res: Response) => {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey || apiKey === "EXA_API_KEY_HERE") {
      res.status(400).json({
        error:
          "Missing EXA_API_KEY. Add it to your .env file (copy .env.example to .env first)."
      });
      return;
    }

    const requestText = req.body?.request?.trim();
    if (!requestText) {
      res.status(400).json({ error: "A request is required." });
      return;
    }

    const count = clamp(Number(req.body.count ?? 250), 10, 1000);
    const createdAt = new Date().toISOString();
    const jobId = createId();
    const job: ContactJob = {
      id: jobId,
      request: requestText,
      count,
      status: "pending",
      createdAt,
      rowCount: 0,
      rows: []
    };

    jobs.set(jobId, job);

    const exa = new Exa(apiKey);
    const webset = await exa.websets.create({
      externalId: `hoa-contact-leads-${Date.now()}`,
      search: {
        count,
        entity: { type: "company" },
        query: buildWebsetQuery(requestText)
      },
      enrichments: ENRICHMENTS.map((item) => ({
        description: item.description,
        format: item.format,
        metadata: {
          field: String(item.key)
        }
      }))
    });

    job.websetId = webset.id;
    job.websetTitle = webset.title ?? undefined;
    job.status = "running";
    job.startedAt = new Date().toISOString();

    void runJob(jobId, apiKey);

    res.json({ job: summarizeJob(job) });
}));

app.get("/api/jobs/:id", route(async (req: Request, res: Response) => {
  const job = jobs.get(getParamValue(req.params.id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json({ job: summarizeJob(job) });
}));

app.get("/api/jobs/:id/results", route(async (req: Request, res: Response) => {
  const job = jobs.get(getParamValue(req.params.id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "completed") {
    res.status(409).json({
      error: "Job is not completed yet.",
      job: summarizeJob(job)
    });
    return;
  }

  res.json({
    job: summarizeJob(job),
    columns: CSV_COLUMNS,
    rows: job.rows
  });
}));

app.get("/api/jobs/:id/export.csv", route(async (req: Request, res: Response) => {
  const job = jobs.get(getParamValue(req.params.id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "completed") {
    res.status(409).json({ error: "Job is not completed yet." });
    return;
  }

  const parser = new Json2CsvParser({ fields: CSV_COLUMNS });
  const csv = parser.parse(job.rows);
  const fileName = `hoa-contacts-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(csv);
}));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "..", "public");

app.use(express.static(publicDir));
app.get(/^\/(?!api).*/, (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown server error";
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, error);
  res.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`HOA contact lead tool running at http://localhost:${port}`);
});

async function runJob(jobId: string, apiKey: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job || !job.websetId) {
    return;
  }

  const exa = new Exa(apiKey);

  try {
    await exa.websets.waitUntilIdle(job.websetId, {
      timeout: 20 * 60_000,
      pollInterval: 3000
    });

    const webset = await exa.websets.get(job.websetId);
    const enrichmentFieldMap = buildEnrichmentFieldMap(webset.enrichments ?? []);
    const items = await exa.websets.items.getAll(job.websetId, { limit: 100 });

    const rows = dedupeRows(items.map((item) => buildRowFromItem(item, enrichmentFieldMap)));

    job.rows = rows;
    job.rowCount = rows.length;
    job.status = "completed";
    job.completedAt = new Date().toISOString();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error while running job.";
    job.status = "failed";
    job.error = message;
    job.completedAt = new Date().toISOString();
  }
}

function buildWebsetQuery(requestText: string): string {
  return [
    "Find homeowners association (HOA) management companies that match this request:",
    requestText,
    "Return management companies where a proprietor, owner, principal, or equivalent leadership contact can be identified.",
    "Prioritize official management company websites and trusted public profiles that include contact details and company size indicators."
  ].join(" ");
}

function summarizeJob(job: ContactJob): Omit<ContactJob, "rows"> {
  return {
    id: job.id,
    request: job.request,
    count: job.count,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    websetId: job.websetId,
    websetTitle: job.websetTitle,
    rowCount: job.rowCount
  };
}

function buildEnrichmentFieldMap(enrichments: WebsetEnrichment[]): Map<string, keyof ContactLeadRow> {
  const map = new Map<string, keyof ContactLeadRow>();

  for (const enrichment of enrichments) {
    const field = enrichment.metadata?.field;
    if (field && isContactRowField(field)) {
      map.set(enrichment.id, field);
    }
  }

  return map;
}

function buildRowFromItem(
  item: WebsetItem,
  enrichmentFieldMap: Map<string, keyof ContactLeadRow>
): ContactLeadRow {
  const base = extractBaseFields(item);

  const row: ContactLeadRow = {
    management_company_name: base.management_company_name,
    management_company_website: base.management_company_website,
    management_company_employee_count: base.management_company_employee_count,
    proprietor_name: "",
    proprietor_title: "",
    proprietor_linkedin: "",
    proprietor_email: "",
    proprietor_phone: "",
    hoa_manager_phone: "",
    contact_page_url: "",
    source_url: base.source_url,
    source_description: base.source_description,
    webset_item_id: item.id
  };

  for (const enrichmentResult of item.enrichments ?? []) {
    const targetField = enrichmentFieldMap.get(enrichmentResult.enrichmentId);
    if (!targetField) {
      continue;
    }

    const value = normalizeEnrichmentResult(enrichmentResult.result);
    if (!value) {
      continue;
    }

    row[targetField] = value;
  }

  if (!row.management_company_website) {
    row.management_company_website = row.source_url;
  }

  return row;
}

function extractBaseFields(item: WebsetItem): {
  management_company_name: string;
  management_company_website: string;
  management_company_employee_count: string;
  source_url: string;
  source_description: string;
} {
  const properties = item.properties as Record<string, unknown>;
  const type = String(properties.type ?? "");

  if (type === "company") {
    const company = getObject(properties, "company");
    return {
      management_company_name: stringOrEmpty(company?.name),
      management_company_website: stringOrEmpty(properties.url),
      management_company_employee_count: numberOrEmpty(company?.employees),
      source_url: stringOrEmpty(properties.url),
      source_description: stringOrEmpty(properties.description)
    };
  }

  if (type === "custom") {
    const custom = getObject(properties, "custom");
    return {
      management_company_name: stringOrEmpty(custom?.title),
      management_company_website: stringOrEmpty(properties.url),
      management_company_employee_count: "",
      source_url: stringOrEmpty(properties.url),
      source_description: stringOrEmpty(properties.description)
    };
  }

  if (type === "person") {
    const person = getObject(properties, "person");
    const company = getObject(person, "company");
    return {
      management_company_name: stringOrEmpty(company?.name),
      management_company_website: stringOrEmpty(properties.url),
      management_company_employee_count: "",
      source_url: stringOrEmpty(properties.url),
      source_description: stringOrEmpty(properties.description)
    };
  }

  return {
    management_company_name: "",
    management_company_website: stringOrEmpty(properties.url),
    management_company_employee_count: "",
    source_url: stringOrEmpty(properties.url),
    source_description: stringOrEmpty(properties.description)
  };
}

function normalizeEnrichmentResult(value: string[] | null): string {
  if (!value || !Array.isArray(value)) {
    return "";
  }

  return value.map((item) => item.trim()).filter(Boolean).join(" | ");
}

function dedupeRows(rows: ContactLeadRow[]): ContactLeadRow[] {
  const seen = new Set<string>();
  const deduped: ContactLeadRow[] = [];

  for (const row of rows) {
    const key = [
      normalizeString(row.management_company_name),
      normalizeString(row.management_company_website),
      normalizeString(row.proprietor_name),
      normalizeString(row.proprietor_email),
      normalizeString(row.proprietor_phone)
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function normalizeString(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function getObject(
  value: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const nested = value?.[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return undefined;
  }
  return nested as Record<string, unknown>;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrEmpty(value: unknown): string {
  return typeof value === "number" ? String(value) : "";
}

function isContactRowField(value: string): value is keyof ContactLeadRow {
  return CSV_COLUMNS.includes(value as keyof ContactLeadRow);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function getParamValue(param: string | string[] | undefined): string {
  if (Array.isArray(param)) {
    return param[0] ?? "";
  }
  return param ?? "";
}

function route<TReq extends Request = Request>(
  handler: (req: TReq, res: Response) => Promise<void> | void
) {
  return (req: TReq, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}
