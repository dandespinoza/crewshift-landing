# 12 — File Storage & Document Generation

> File storage handles job photos, invoice PDFs, estimate PDFs, and estimate input photos. Files are stored in Cloudflare R2 (S3-compatible), uploaded via presigned URLs, and served via presigned download URLs. PDF generation is handled by a dedicated BullMQ worker using Puppeteer to render HTML templates.

**Cross-references:** [03-api-routes.md](./03-api-routes.md) (upload presign + confirm routes), [07-agent-definitions.md](./07-agent-definitions.md) (Invoice Agent triggers PDF generation, Estimate Agent uses photo pipeline), [10-ai-service.md](./10-ai-service.md) (vision endpoint for photo-to-estimate), [14-queue-system.md](./14-queue-system.md) (pdf-generation queue)

---

## Table of Contents

1. [Storage Provider: Cloudflare R2](#storage-provider-cloudflare-r2)
2. [Presigned URL Upload Flow](#presigned-url-upload-flow)
3. [Bucket Organization](#bucket-organization)
4. [PDF Generation Pipeline](#pdf-generation-pipeline)
5. [PDF Templates](#pdf-templates)
6. [Puppeteer Configuration](#puppeteer-configuration)
7. [Photo-to-Estimate Pipeline](#photo-to-estimate-pipeline)
8. [File Types](#file-types)
9. [File Access](#file-access)
10. [Storage Limits per Tier](#storage-limits-per-tier)
11. [Storage Tracking and Cleanup](#storage-tracking-and-cleanup)
12. [Decision Rationale](#decision-rationale)

---

## Storage Provider: Cloudflare R2

**Choice: Cloudflare R2 (preferred over AWS S3)**

| Factor | Cloudflare R2 | AWS S3 |
|---|---|---|
| Storage cost | $0.015/GB/month | $0.023/GB/month (Standard) |
| Egress (data transfer out) | **$0.00 (free)** | $0.09/GB (first 10TB) |
| API compatibility | S3-compatible | Native S3 |
| CDN | Built-in (Cloudflare edge) | CloudFront (additional config) |
| Presigned URLs | Yes (S3-compatible) | Yes |
| Region | Automatic (distributed) | Must choose region |

**Why R2 over S3:**

- **No egress fees.** This is the decisive factor. Invoice PDFs and estimate PDFs are downloaded by customers (via email links) and contractors (via dashboard). With S3, every PDF download costs $0.09/GB. With R2, it's free. At scale with thousands of PDFs downloaded monthly, this adds up to significant savings.
- **S3-compatible API.** The `@aws-sdk/client-s3` package works with R2 by changing the endpoint URL. Zero code changes if we ever switch back to S3.
- **Simpler pricing.** No data transfer tiers, no complex pricing calculators.

### R2 Configuration

```typescript
// config/storage.ts
import { S3Client } from '@aws-sdk/client-s3';

export const storageClient = new S3Client({
  region: 'auto', // R2 uses 'auto' — it distributes globally
  endpoint: env.R2_ENDPOINT, // https://<account_id>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

export const BUCKET_NAME = env.R2_BUCKET_NAME || 'crewshift-files';
```

### Environment Variables

```env
# Cloudflare R2
R2_ENDPOINT=https://abcdef1234567890.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=crewshift-files
R2_PUBLIC_URL=https://files.crewshift.com  # Custom domain via R2 public bucket or Cloudflare Workers
```

---

## Presigned URL Upload Flow

Files are never uploaded through the CrewShift API server. Instead, the frontend gets a presigned URL from the API and uploads directly to R2. This keeps large files off the API server and avoids memory/CPU pressure.

### Step-by-Step Flow

```
Frontend (browser)                     Node.js API                          Cloudflare R2
     │                                      │                                     │
     │ 1. POST /api/upload/presign          │                                     │
     │    { filename, content_type,         │                                     │
     │      entity_type, entity_id }        │                                     │
     ├─────────────────────────────────────▶│                                     │
     │                                      │ 2. Validate request                 │
     │                                      │    Generate unique S3 key           │
     │                                      │    Create presigned PUT URL         │
     │                                      │    (expires in 15 minutes)          │
     │◀─────────────────────────────────────┤                                     │
     │ { upload_url, key, expires_at }      │                                     │
     │                                      │                                     │
     │ 3. PUT upload_url                    │                                     │
     │    (direct upload to R2)             │                                     │
     ├────────────────────────────────────────────────────────────────────────────▶│
     │                                      │                                     │
     │◀────────────────────────────────────────────────────────────────────────────┤
     │ 200 OK                               │                                     │
     │                                      │                                     │
     │ 4. POST /api/upload/confirm          │                                     │
     │    { key, entity_type, entity_id }   │                                     │
     ├─────────────────────────────────────▶│                                     │
     │                                      │ 5. Verify file exists in R2         │
     │                                      │    Update DB record with file URL   │
     │                                      │    (e.g., jobs.photos[], invoices.pdf_url)
     │◀─────────────────────────────────────┤                                     │
     │ { url, size }                        │                                     │
```

### Implementation

```typescript
// routes/upload.routes.ts
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { storageClient, BUCKET_NAME } from '../config/storage';
import { randomUUID } from 'crypto';

// POST /api/upload/presign — Generate a presigned upload URL
app.post('/api/upload/presign', {
  preHandler: [authMiddleware],
  schema: {
    body: {
      type: 'object',
      required: ['filename', 'content_type', 'entity_type'],
      properties: {
        filename: { type: 'string' },
        content_type: { type: 'string', enum: [
          'image/jpeg', 'image/png', 'image/webp', 'image/heic',
          'application/pdf',
        ]},
        entity_type: { type: 'string', enum: [
          'job_photo', 'estimate_photo', 'invoice_pdf', 'estimate_pdf',
        ]},
        entity_id: { type: 'string', format: 'uuid' },
      },
    },
  },
}, async (request, reply) => {
  const { filename, content_type, entity_type, entity_id } = request.body;
  const orgId = request.orgId;

  // Check storage quota
  const usage = await getStorageUsage(orgId);
  const limit = STORAGE_LIMITS[request.orgTier]; // 1GB, 10GB, 50GB
  if (usage >= limit) {
    return reply.status(422).send({
      error: {
        code: 'STORAGE_LIMIT_REACHED',
        message: `Storage limit of ${formatBytes(limit)} reached. Upgrade to increase.`,
      },
    });
  }

  // Generate S3 key based on entity type
  const fileId = randomUUID();
  const ext = filename.split('.').pop();
  const key = buildS3Key(orgId, entity_type, entity_id, fileId, ext);

  // Create presigned PUT URL (expires in 15 minutes)
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: content_type,
    // Metadata for tracking
    Metadata: {
      'org-id': orgId,
      'entity-type': entity_type,
      'entity-id': entity_id || '',
      'uploaded-by': request.userId,
    },
  });

  const uploadUrl = await getSignedUrl(storageClient, command, {
    expiresIn: 900, // 15 minutes
  });

  return reply.send({
    data: {
      upload_url: uploadUrl,
      key,
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    },
  });
});


// POST /api/upload/confirm — Confirm upload and associate with DB record
app.post('/api/upload/confirm', {
  preHandler: [authMiddleware],
  schema: {
    body: {
      type: 'object',
      required: ['key', 'entity_type'],
      properties: {
        key: { type: 'string' },
        entity_type: { type: 'string' },
        entity_id: { type: 'string', format: 'uuid' },
      },
    },
  },
}, async (request, reply) => {
  const { key, entity_type, entity_id } = request.body;
  const orgId = request.orgId;

  // Verify the key belongs to this org (security check)
  if (!key.startsWith(`${orgId}/`)) {
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'File does not belong to this organization' },
    });
  }

  // Verify file exists in R2
  try {
    const head = await storageClient.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));

    const fileSize = head.ContentLength;
    const fileUrl = `${env.R2_PUBLIC_URL}/${key}`;

    // Update the appropriate DB record
    switch (entity_type) {
      case 'job_photo':
        // Append to jobs.photos array
        await db.query(
          `UPDATE jobs SET photos = array_append(photos, $1), updated_at = NOW()
           WHERE id = $2 AND org_id = $3`,
          [fileUrl, entity_id, orgId],
        );
        break;

      case 'estimate_photo':
        // Append to estimates.photos array
        await db.query(
          `UPDATE estimates SET photos = array_append(photos, $1), updated_at = NOW()
           WHERE id = $2 AND org_id = $3`,
          [fileUrl, entity_id, orgId],
        );
        break;

      case 'invoice_pdf':
        // Set invoices.pdf_url
        await db.query(
          `UPDATE invoices SET pdf_url = $1, updated_at = NOW()
           WHERE id = $2 AND org_id = $3`,
          [fileUrl, entity_id, orgId],
        );
        break;

      case 'estimate_pdf':
        // Set estimates.pdf_url
        await db.query(
          `UPDATE estimates SET pdf_url = $1, updated_at = NOW()
           WHERE id = $2 AND org_id = $3`,
          [fileUrl, entity_id, orgId],
        );
        break;
    }

    // Track storage usage
    await trackStorageUsage(orgId, fileSize);

    return reply.send({
      data: { url: fileUrl, size: fileSize, key },
    });
  } catch (error) {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'File not found in storage. Upload may have failed.' },
    });
  }
});
```

---

## Bucket Organization

All files for all organizations live in a single R2 bucket, organized by `org_id` at the top level. This provides natural multi-tenant isolation at the storage path level.

```
crewshift-files/                          ← R2 bucket
├── {org_id}/                             ← Organization root
│   ├── jobs/
│   │   └── {job_id}/
│   │       └── photos/
│   │           ├── {uuid}.jpg            ← Job site photos
│   │           ├── {uuid}.jpg
│   │           └── {uuid}.png
│   ├── invoices/
│   │   └── {invoice_id}/
│   │       └── invoice.pdf               ← Generated invoice PDF
│   ├── estimates/
│   │   └── {estimate_id}/
│   │       ├── estimate.pdf              ← Generated estimate PDF
│   │       └── input-photos/
│   │           ├── {uuid}.jpg            ← Photos used to generate the estimate
│   │           └── {uuid}.jpg
│   └── receipts/                         ← Future: receipt scanning for bookkeeping
│       └── {uuid}.jpg
```

### Key Generation Function

```typescript
function buildS3Key(
  orgId: string,
  entityType: string,
  entityId: string | undefined,
  fileId: string,
  extension: string,
): string {
  switch (entityType) {
    case 'job_photo':
      return `${orgId}/jobs/${entityId}/photos/${fileId}.${extension}`;
    case 'estimate_photo':
      return `${orgId}/estimates/${entityId}/input-photos/${fileId}.${extension}`;
    case 'invoice_pdf':
      return `${orgId}/invoices/${entityId}/invoice.pdf`;
    case 'estimate_pdf':
      return `${orgId}/estimates/${entityId}/estimate.pdf`;
    default:
      return `${orgId}/misc/${fileId}.${extension}`;
  }
}
```

**Design decisions:**

- **Single bucket, org prefix.** One bucket is simpler to manage than per-org buckets. The `org_id` prefix provides isolation. Access control is enforced at the API layer (presigned URLs are scoped to the org), not at the bucket policy level.
- **UUIDs for filenames.** Original filenames are not used in the S3 key — they could contain special characters, spaces, or duplicate names. The UUID ensures uniqueness and avoids path injection.
- **Deterministic PDF paths.** Invoice and estimate PDFs have predictable keys (`invoice.pdf`, `estimate.pdf`) because there's exactly one PDF per entity. Photos use UUIDs because there can be many per entity.

---

## PDF Generation Pipeline

Invoice and estimate PDFs are generated by a dedicated BullMQ worker using Puppeteer (headless Chrome) to render HTML templates. This is intentionally decoupled from the API — Puppeteer is CPU/memory heavy and should not run in the request path.

### Full Flow

```
Agent creates invoice in DB
  │
  ▼
Event: 'invoice.created'
  │
  ▼
BullMQ: pdf-generation queue
  │  Job payload: { type: 'invoice', entity_id: 'uuid', org_id: 'uuid' }
  │
  ▼
pdf.worker.ts picks up the job
  │
  ├── 1. Fetch invoice data from DB (with customer, org, line items)
  │
  ├── 2. Load HTML template (invoice.template.html)
  │
  ├── 3. Inject data into template (Handlebars/EJS)
  │       - Render line items table
  │       - Calculate subtotal, tax, total
  │       - Add business logo, address, contact info
  │       - Add customer name, address
  │       - Add payment terms, due date
  │
  ├── 4. Launch Puppeteer (headless Chrome)
  │       - Load rendered HTML
  │       - Set page size to Letter (8.5" x 11")
  │       - Print to PDF with margins
  │
  ├── 5. Upload PDF to R2
  │       - Key: {org_id}/invoices/{invoice_id}/invoice.pdf
  │       - Content-Type: application/pdf
  │
  ├── 6. Update invoices.pdf_url in DB
  │
  └── 7. Emit 'invoice.pdf_generated' event
        (Collections Agent may use this to include PDF in follow-up emails)
```

### pdf.worker.ts

```typescript
// queue/workers/pdf.worker.ts
import { Worker, Job } from 'bullmq';
import puppeteer, { Browser } from 'puppeteer';
import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { storageClient, BUCKET_NAME } from '../../config/storage';
import { redisConnection } from '../../config/redis';
import { db } from '../../db';
import { logger } from '../../utils/logger';

// Load and compile templates once at startup (not per request)
const TEMPLATES = {
  invoice: Handlebars.compile(
    readFileSync(join(__dirname, '../../templates/invoice.template.html'), 'utf-8')
  ),
  estimate: Handlebars.compile(
    readFileSync(join(__dirname, '../../templates/estimate.template.html'), 'utf-8')
  ),
};

const STYLES = readFileSync(join(__dirname, '../../templates/styles.css'), 'utf-8');

// Register Handlebars helpers
Handlebars.registerHelper('currency', (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
);
Handlebars.registerHelper('date', (value: string) =>
  new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
);
Handlebars.registerHelper('multiply', (a: number, b: number) => a * b);

// Shared browser instance (reused across PDF generations for performance)
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Prevents /dev/shm from filling up in Docker
        '--disable-gpu',
        '--single-process',        // Reduces memory in containers
      ],
    });
  }
  return browser;
}

interface PDFJobData {
  type: 'invoice' | 'estimate';
  entity_id: string;
  org_id: string;
}

const pdfWorker = new Worker<PDFJobData>(
  'pdf-generation',
  async (job: Job<PDFJobData>) => {
    const { type, entity_id, org_id } = job.data;
    const startTime = Date.now();

    logger.info('pdf_generation_started', { type, entity_id, org_id, job_id: job.id });

    try {
      // 1. Fetch data from DB
      let data: Record<string, any>;
      if (type === 'invoice') {
        data = await fetchInvoiceData(entity_id, org_id);
      } else {
        data = await fetchEstimateData(entity_id, org_id);
      }

      // 2. Render HTML from template
      const template = TEMPLATES[type];
      const html = template({
        ...data,
        styles: STYLES,
        generated_at: new Date().toISOString(),
      });

      // 3. Generate PDF with Puppeteer
      const browserInstance = await getBrowser();
      const page = await browserInstance.newPage();

      try {
        await page.setContent(html, {
          waitUntil: 'networkidle0',
          timeout: 15000, // 15 second timeout for template rendering
        });

        const pdfBuffer = await page.pdf({
          format: 'Letter',           // 8.5" x 11" — standard US paper
          printBackground: true,       // Include background colors/images
          margin: {
            top: '0.5in',
            right: '0.5in',
            bottom: '0.75in',         // Extra bottom margin for footer
            left: '0.5in',
          },
          displayHeaderFooter: true,
          footerTemplate: `
            <div style="font-size: 9px; color: #666; text-align: center; width: 100%;">
              Generated by CrewShift &mdash; Page <span class="pageNumber"></span> of <span class="totalPages"></span>
            </div>
          `,
          headerTemplate: '<div></div>', // Empty header (content is in the template)
        });

        // 4. Upload to R2
        const key = `${org_id}/${type === 'invoice' ? 'invoices' : 'estimates'}/${entity_id}/${type}.pdf`;

        await storageClient.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
          Metadata: {
            'org-id': org_id,
            'entity-type': `${type}_pdf`,
            'entity-id': entity_id,
          },
        }));

        const pdfUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

        // 5. Update DB
        const table = type === 'invoice' ? 'invoices' : 'estimates';
        await db.query(
          `UPDATE ${table} SET pdf_url = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3`,
          [pdfUrl, entity_id, org_id],
        );

        // 6. Track storage
        await trackStorageUsage(org_id, pdfBuffer.length);

        const durationMs = Date.now() - startTime;
        logger.info('pdf_generation_completed', {
          type, entity_id, org_id,
          size_bytes: pdfBuffer.length,
          duration_ms: durationMs,
          pdf_url: pdfUrl,
        });

        return { pdf_url: pdfUrl, size_bytes: pdfBuffer.length };

      } finally {
        await page.close(); // Always close the page, even on error
      }

    } catch (error) {
      logger.error('pdf_generation_failed', {
        type, entity_id, org_id,
        error: error.message,
        duration_ms: Date.now() - startTime,
      });
      throw error; // BullMQ will retry based on queue config
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,       // Max 2 concurrent PDF generations (Puppeteer is memory-heavy)
    limiter: {
      max: 10,            // Max 10 PDF generations per...
      duration: 60_000,   // ...minute (rate limit to prevent resource exhaustion)
    },
  },
);

// Helper: Fetch full invoice data with relations
async function fetchInvoiceData(invoiceId: string, orgId: string) {
  const invoice = await db.queryOne(
    `SELECT i.*, c.name as customer_name, c.email as customer_email, c.address as customer_address,
            o.name as org_name, o.settings as org_settings
     FROM invoices i
     JOIN customers c ON c.id = i.customer_id
     JOIN organizations o ON o.id = i.org_id
     WHERE i.id = $1 AND i.org_id = $2`,
    [invoiceId, orgId],
  );

  return {
    invoice_number: invoice.invoice_number,
    date: invoice.created_at,
    due_date: invoice.due_date,
    line_items: invoice.line_items,
    subtotal: invoice.subtotal,
    tax_rate: invoice.tax_rate,
    tax_amount: invoice.tax_amount,
    total: invoice.total,
    notes: invoice.notes,
    payment_method: invoice.payment_method,
    customer: {
      name: invoice.customer_name,
      email: invoice.customer_email,
      address: invoice.customer_address,
    },
    business: {
      name: invoice.org_name,
      logo_url: invoice.org_settings?.logo_url,
      address: invoice.org_settings?.address,
      phone: invoice.org_settings?.phone,
      email: invoice.org_settings?.email,
      license_number: invoice.org_settings?.license_number,
    },
  };
}
```

---

## PDF Templates

### invoice.template.html

The invoice template is a complete HTML document with embedded CSS (no external requests). It's designed to render well both as a web page preview and as a printed PDF.

**Structure:**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>{{{styles}}}</style>
</head>
<body>
  <!-- Header: Business branding -->
  <div class="header">
    <div class="business-info">
      {{#if business.logo_url}}
        <img src="{{business.logo_url}}" class="logo" alt="{{business.name}}" />
      {{/if}}
      <h1>{{business.name}}</h1>
      <p>{{business.address.street}}, {{business.address.city}}, {{business.address.state}} {{business.address.zip}}</p>
      <p>{{business.phone}} | {{business.email}}</p>
      {{#if business.license_number}}
        <p class="license">License #{{business.license_number}}</p>
      {{/if}}
    </div>
    <div class="invoice-meta">
      <h2>INVOICE</h2>
      <p><strong>#{{invoice_number}}</strong></p>
      <p>Date: {{date date}}</p>
      <p>Due: {{date due_date}}</p>
    </div>
  </div>

  <!-- Bill To -->
  <div class="bill-to">
    <h3>Bill To:</h3>
    <p><strong>{{customer.name}}</strong></p>
    {{#if customer.address}}
      <p>{{customer.address.street}}</p>
      <p>{{customer.address.city}}, {{customer.address.state}} {{customer.address.zip}}</p>
    {{/if}}
    {{#if customer.email}}<p>{{customer.email}}</p>{{/if}}
  </div>

  <!-- Line Items Table -->
  <table class="line-items">
    <thead>
      <tr>
        <th class="desc">Description</th>
        <th class="qty">Qty</th>
        <th class="price">Unit Price</th>
        <th class="total">Total</th>
      </tr>
    </thead>
    <tbody>
      {{#each line_items}}
      <tr>
        <td class="desc">{{this.description}}</td>
        <td class="qty">{{this.quantity}}</td>
        <td class="price">{{currency this.unit_price}}</td>
        <td class="total">{{currency this.total}}</td>
      </tr>
      {{/each}}
    </tbody>
  </table>

  <!-- Totals -->
  <div class="totals">
    <div class="total-row">
      <span>Subtotal:</span>
      <span>{{currency subtotal}}</span>
    </div>
    {{#if tax_amount}}
    <div class="total-row">
      <span>Tax ({{multiply tax_rate 100}}%):</span>
      <span>{{currency tax_amount}}</span>
    </div>
    {{/if}}
    <div class="total-row grand-total">
      <span>Total Due:</span>
      <span>{{currency total}}</span>
    </div>
  </div>

  <!-- Notes -->
  {{#if notes}}
  <div class="notes">
    <h3>Notes</h3>
    <p>{{notes}}</p>
  </div>
  {{/if}}

  <!-- Payment Info -->
  <div class="payment-info">
    <h3>Payment Information</h3>
    <p>Payment is due by {{date due_date}}.</p>
    <p>Accepted methods: Check, Credit Card, ACH Transfer</p>
    {{#if payment_link}}
      <p><a href="{{payment_link}}">Pay Online</a></p>
    {{/if}}
  </div>

  <!-- Footer -->
  <div class="footer">
    <p>Thank you for your business!</p>
    <p class="powered-by">Powered by CrewShift</p>
  </div>
</body>
</html>
```

### estimate.template.html

Similar structure to the invoice template, with these differences:

- Header says "ESTIMATE" instead of "INVOICE"
- Includes `estimate_number` and `valid_until` date
- Includes `scope_description` section (what work will be performed)
- Line items may include `confidence` indicators for AI-generated estimates
- Footer includes "This estimate is valid until {date}" instead of payment info
- Includes acceptance signature line: "Signature: ____________ Date: ____________"
- Includes terms and conditions section

### styles.css

Shared stylesheet used by both templates. Key design decisions:

- **Print-optimized:** Uses `@page` rules for margins, page breaks, and headers/footers
- **Clean, professional:** White background, dark text, subtle borders. Not flashy — contractors send these to homeowners
- **Brand-neutral:** Business logo and colors come from org settings, not hardcoded CrewShift branding (except subtle "Powered by CrewShift" footer)
- **Table-friendly:** Line items table has alternating row colors, clear headers, right-aligned currency columns
- **Mobile-readable:** PDFs viewed on phones should be legible (adequate font size, spacing)

```css
/* Core styles (abbreviated) */
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; font-size: 12px; line-height: 1.5; }
.header { display: flex; justify-content: space-between; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #333; }
.logo { max-height: 60px; max-width: 200px; }
.line-items { width: 100%; border-collapse: collapse; margin: 20px 0; }
.line-items th { background: #f5f5f5; padding: 8px 12px; text-align: left; border-bottom: 2px solid #ddd; }
.line-items td { padding: 8px 12px; border-bottom: 1px solid #eee; }
.line-items tr:nth-child(even) { background: #fafafa; }
.qty, .price, .total { text-align: right; }
.totals { margin-left: auto; width: 300px; }
.total-row { display: flex; justify-content: space-between; padding: 5px 0; }
.grand-total { font-size: 16px; font-weight: bold; border-top: 2px solid #333; padding-top: 10px; margin-top: 5px; }
.powered-by { font-size: 9px; color: #999; margin-top: 20px; }
@page { size: Letter; margin: 0.5in 0.5in 0.75in 0.5in; }
```

---

## Puppeteer Configuration

Puppeteer runs headless Chrome to render HTML templates into PDFs. It's resource-intensive and requires careful configuration, especially in Docker/containerized environments.

### Docker Configuration

```dockerfile
# Dockerfile for the Node API (includes Puppeteer)
FROM node:20-slim

# Install Chrome dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use installed Chromium instead of downloading its own
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Memory and performance settings
ENV NODE_OPTIONS="--max-old-space-size=512"

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

CMD ["node", "dist/server.js"]
```

### Resource Limits

| Setting | Value | Rationale |
|---|---|---|
| Worker concurrency | 2 | Each Puppeteer page uses ~50-100MB RAM. 2 concurrent = ~200MB peak. |
| Rate limit | 10/minute | Prevents resource exhaustion during bulk operations |
| Page timeout | 15 seconds | Templates are local HTML — if rendering takes >15s, something is wrong |
| PDF timeout | 30 seconds | Large invoices with many line items can take time |
| Browser reuse | Shared instance | Launching Chrome per PDF costs ~1-2 seconds. Reusing saves 80% of generation time |
| `--disable-dev-shm-usage` | Enabled | Docker containers have a 64MB /dev/shm by default — Chrome can exceed this |
| `--single-process` | Enabled | Reduces memory footprint in containers |
| Max file size | 10MB | Safety limit — a normal invoice PDF is 50-200KB |

### Memory Management

```typescript
// Periodic browser restart to prevent memory leaks
let pdfCount = 0;
const MAX_PDFS_BEFORE_RESTART = 100;

async function getBrowser(): Promise<Browser> {
  pdfCount++;

  // Restart browser every 100 PDFs to clear accumulated memory
  if (pdfCount >= MAX_PDFS_BEFORE_RESTART && browser) {
    logger.info('restarting_browser', { pdf_count: pdfCount });
    await browser.close();
    browser = null;
    pdfCount = 0;
  }

  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({ /* ... args ... */ });
  }
  return browser;
}
```

---

## Photo-to-Estimate Pipeline

This pipeline is the Estimate Agent's vision-powered flow: a contractor uploads job site photos, the AI analyzes them to identify materials and conditions, and then generates a detailed cost estimate.

### Full Pipeline

```
1. Contractor uploads photos via presigned URLs
   └── POST /api/upload/presign (entity_type: 'estimate_photo')
   └── Direct PUT to R2
   └── POST /api/upload/confirm

2. Contractor requests estimate
   └── POST /api/estimates
   └── Body: { customer_id, photo_keys: [...], scope_description: "Replace AC unit..." }
   └── Or via copilot: "Build an estimate from these photos for the Henderson job"

3. Estimate Agent triggers
   └── Event: 'estimate.requested'
   └── Agent gathers: photos, scope description, customer data, org settings,
                       historical estimates for similar jobs, current parts pricing

4. Step 1: Vision Analysis
   └── POST /ai/vision (Python AI service)
   └── Sends photo URLs + analysis prompt
   └── Gemini 2.5 Flash Vision analyzes images
   └── Returns: identified equipment, materials needed, measurements,
                visible damage/issues, access conditions

5. Step 2: Estimate Generation
   └── POST /ai/reason (Python AI service)
   └── Sends vision analysis output + scope description + historical pricing
   └── Claude Sonnet generates structured estimate:
       - Line items with descriptions, quantities, unit prices
       - Labor estimate based on job complexity
       - Material costs from supplier pricing data
       - Total with tax
       - Confidence score per line item and overall

6. Step 3: Validation
   └── Agent validates: line_items.length > 0, subtotal == sum(totals),
                        total > 0, confidence > threshold

7. Step 4: Autonomy Check
   └── Based on org's estimate agent config:
       - Auto if total < threshold AND confidence > 0.9
       - Review if total > threshold OR confidence < 0.9
       - Escalate if confidence < 0.6

8. Step 5: Save estimate to DB
   └── INSERT into estimates table
   └── photos column = input photo URLs
   └── confidence_score = AI confidence
   └── generated_by = 'agent'

9. Step 6: Generate PDF
   └── BullMQ pdf-generation queue
   └── estimate.template.html rendered with estimate data

10. Step 7: Notify
    └── In-app notification: "Estimate #E-1001 for Henderson generated ($4,611)"
```

### Vision Analysis Prompt (sent to /ai/vision)

The vision prompt is trade-specific and instructs the model to look for:

- **Equipment:** Type (AC unit, water heater, ductwork, etc.), brand, model number (if readable), age/condition
- **Materials:** What materials would be needed for the scope of work
- **Measurements:** Approximate dimensions visible in photos (duct runs, pipe lengths, clearances)
- **Issues:** Damage, wear, code violations, safety concerns
- **Access:** Indoor/outdoor, clearance for equipment, roof access, confined spaces

The structured output from vision analysis becomes the input for the reasoning step, where Claude Sonnet generates the actual estimate with pricing.

---

## File Types

| File Type | Entity | Storage Path | Upload Source | Format |
|---|---|---|---|---|
| Job site photos | jobs.photos[] | `/{org_id}/jobs/{job_id}/photos/{uuid}.jpg` | Contractor (mobile/web upload) | JPEG, PNG, WebP, HEIC |
| Estimate input photos | estimates.photos[] | `/{org_id}/estimates/{estimate_id}/input-photos/{uuid}.jpg` | Contractor (for AI analysis) | JPEG, PNG, WebP, HEIC |
| Invoice PDF | invoices.pdf_url | `/{org_id}/invoices/{invoice_id}/invoice.pdf` | System (Puppeteer worker) | PDF |
| Estimate PDF | estimates.pdf_url | `/{org_id}/estimates/{estimate_id}/estimate.pdf` | System (Puppeteer worker) | PDF |

**Not stored (Phase 2):**
- Receipt images (Bookkeeping Agent — receipt scanning)
- Compliance documents (Compliance Agent — permit PDFs, certification scans)
- Customer signatures (Estimate acceptance)

---

## File Access

### PDFs: Presigned Download URLs (Time-Limited)

When a customer receives an invoice email or a contractor downloads a PDF from the dashboard, they receive a presigned download URL that expires after a set time.

```typescript
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// GET /api/invoices/:id/pdf — Get a time-limited download URL
app.get('/api/invoices/:id/pdf', {
  preHandler: [authMiddleware],
}, async (request, reply) => {
  const invoice = await db.queryOne(
    'SELECT pdf_url FROM invoices WHERE id = $1 AND org_id = $2',
    [request.params.id, request.orgId],
  );

  if (!invoice?.pdf_url) {
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'PDF not yet generated' },
    });
  }

  // Extract the S3 key from the stored URL
  const key = extractKeyFromUrl(invoice.pdf_url);

  // Generate presigned GET URL (expires in 1 hour)
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  const downloadUrl = await getSignedUrl(storageClient, command, {
    expiresIn: 3600, // 1 hour
  });

  return reply.send({ data: { download_url: downloadUrl, expires_in: 3600 } });
});
```

### Customer-Facing PDF Links

When an invoice is emailed to a customer, the link goes through a public endpoint that generates a presigned URL on the fly:

```
https://api.crewshift.com/public/invoices/{invoice_id}/pdf?token={access_token}
```

The `access_token` is a short-lived JWT that encodes the invoice ID and org ID. This allows unauthenticated access to a specific PDF without exposing the R2 storage directly.

### Photos: R2 Public URL

Job photos and estimate input photos are served via R2's public URL feature (or a Cloudflare Worker). They don't need time-limited URLs because they're only accessed by authenticated users in the dashboard.

```
https://files.crewshift.com/{org_id}/jobs/{job_id}/photos/{uuid}.jpg
```

Access control is at the application layer (only authenticated users with the correct `org_id` can see the URLs in API responses). The R2 bucket itself can be configured with a custom domain via Cloudflare.

---

## Storage Limits per Tier

| Tier | Storage Limit | Typical Usage |
|---|---|---|
| Starter | 1 GB | ~200 invoice PDFs + ~500 job photos |
| Pro | 10 GB | ~2,000 invoice/estimate PDFs + ~5,000 photos |
| Business | 50 GB | ~10,000 PDFs + ~25,000 photos |
| Enterprise | Custom (negotiated) | Unlimited for most practical purposes |

### Enforcement

```typescript
// Storage usage tracking
const STORAGE_LIMITS: Record<string, number> = {
  starter: 1 * 1024 * 1024 * 1024,      // 1 GB
  pro: 10 * 1024 * 1024 * 1024,          // 10 GB
  business: 50 * 1024 * 1024 * 1024,     // 50 GB
  enterprise: 500 * 1024 * 1024 * 1024,  // 500 GB (effectively unlimited)
};

// Track cumulative storage per org
// Stored in organizations.settings.storage_used_bytes (JSONB)
async function trackStorageUsage(orgId: string, sizeBytes: number): Promise<void> {
  await db.query(
    `UPDATE organizations
     SET settings = jsonb_set(
       COALESCE(settings, '{}'),
       '{storage_used_bytes}',
       (COALESCE((settings->>'storage_used_bytes')::bigint, 0) + $1)::text::jsonb
     )
     WHERE id = $2`,
    [sizeBytes, orgId],
  );
}

async function getStorageUsage(orgId: string): Promise<number> {
  const result = await db.queryOne(
    `SELECT COALESCE((settings->>'storage_used_bytes')::bigint, 0) as used
     FROM organizations WHERE id = $1`,
    [orgId],
  );
  return result.used;
}
```

**Enforcement behavior:**

- At **80%** of limit: warning notification to org owner ("You've used 80% of your 1GB storage. Upgrade to Pro for 10GB.")
- At **100%** of limit: new uploads are blocked (presign endpoint returns 422). Existing files are unaffected. PDF generation is unaffected (these are system-generated, not user uploads — blocking PDF generation would break core functionality).

---

## Storage Tracking and Cleanup

### No Auto-Deletion

Files are never automatically deleted. Even if an org downgrades or churns, their files remain in R2. This is because:

1. **Legal requirements:** Invoices and estimates may be needed for tax purposes for 7+ years
2. **Customer expectation:** Contractors expect to access old invoices and photos
3. **R2 storage is cheap:** At $0.015/GB/month, storing 10GB costs $0.15/month
4. **Re-activation:** If a churned customer comes back, their data should still be there

### Manual Cleanup

Org owners can request data deletion through support. When an org is permanently deleted (GDPR/CCPA request), all files in `/{org_id}/` are deleted via an R2 ListObjects + DeleteObjects batch operation.

```typescript
// Admin-only: delete all files for an organization
async function deleteOrgFiles(orgId: string): Promise<{ deleted: number }> {
  let deletedCount = 0;
  let continuationToken: string | undefined;

  do {
    const listResult = await storageClient.send(new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `${orgId}/`,
      ContinuationToken: continuationToken,
    }));

    if (listResult.Contents && listResult.Contents.length > 0) {
      await storageClient.send(new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: {
          Objects: listResult.Contents.map(obj => ({ Key: obj.Key })),
        },
      }));
      deletedCount += listResult.Contents.length;
    }

    continuationToken = listResult.NextContinuationToken;
  } while (continuationToken);

  // Reset storage counter
  await db.query(
    `UPDATE organizations SET settings = jsonb_set(settings, '{storage_used_bytes}', '0') WHERE id = $1`,
    [orgId],
  );

  return { deleted: deletedCount };
}
```

### Usage Dashboard

Storage usage is exposed via `GET /api/dashboard/usage`:

```json
{
  "storage": {
    "used_bytes": 524288000,
    "used_formatted": "500 MB",
    "limit_bytes": 1073741824,
    "limit_formatted": "1 GB",
    "percent_used": 48.8,
    "breakdown": {
      "job_photos": { "count": 234, "bytes": 312000000 },
      "invoice_pdfs": { "count": 89, "bytes": 15600000 },
      "estimate_pdfs": { "count": 45, "bytes": 9800000 },
      "estimate_photos": { "count": 120, "bytes": 186888000 }
    }
  }
}
```

---

## Decision Rationale

| Decision | Choice | Alternatives Considered | Why |
|---|---|---|---|
| Storage provider | Cloudflare R2 | AWS S3, Google Cloud Storage, Supabase Storage | R2 has zero egress fees — critical for PDFs downloaded by customers. S3-compatible API means zero migration effort if we switch. |
| Upload method | Presigned URLs (direct to R2) | Upload through API server, multipart upload to API | Presigned URLs keep large files off the API server. No memory pressure, no bandwidth bottleneck, no request timeout risk. The API server only handles metadata. |
| PDF generation | Puppeteer (headless Chrome) | React-PDF, PDFKit, wkhtmltopdf, Gotenberg | Puppeteer renders real HTML/CSS — designers can build templates in a browser and they'll look identical as PDFs. React-PDF requires learning a custom component library. PDFKit is low-level. wkhtmltopdf is unmaintained. |
| PDF templates | Handlebars HTML | EJS, React-PDF, LaTeX | Handlebars is simple, battle-tested, and templates can be previewed in a browser. EJS would also work — the choice is marginal. React-PDF would require a React dependency in the Node API. |
| Shared Puppeteer browser | Reuse instance, restart every 100 PDFs | New browser per PDF, browser pool | New browser per PDF adds 1-2s startup time. Shared instance is fast but leaks memory over time. Periodic restart (every 100 PDFs) balances speed and memory stability. |
| Single bucket | One bucket, org_id prefix | Per-org buckets | One bucket is simpler to manage. Org isolation is enforced at the API layer (presigned URLs scoped to org). R2 doesn't charge per-bucket, but managing thousands of buckets is operational overhead. |
| No auto-deletion | Keep all files indefinitely | Auto-delete after 90 days, lifecycle policies | Invoices have legal retention requirements (7+ years for taxes). Storage is cheap ($0.015/GB/month). Deleting a contractor's invoice history would be a trust-destroying mistake. |
| Storage tracking | Counter in organizations.settings JSONB | Separate storage_usage table, R2 API list+sum | A simple counter updated on each upload is fast and accurate enough. Querying R2 for actual usage is slow and expensive at scale. A separate table adds complexity for a single number. |
