# Invoice Agent — Full Scope

The invoice agent is your AI accounts receivable clerk. It creates invoices, sends them, tracks them, and makes sure money comes in. It reads from your field service tool (Jobber, ServiceTitan, Housecall Pro) and your accounting tool (QuickBooks, Xero) and keeps them in sync.

CrewShift doesn't replace those tools. It's the intelligence layer on top — it reads the data, reasons about it, and either acts back into those systems or tells the owner what to do.

---

## The Core Job

A job is done. Someone needs to turn that into a bill, send it to the right person, in the right format, with the right backup, at the right time. Then track whether it got paid. Most contractors are 2-7 days late invoicing because the owner is too busy. That's free float the customer is getting on YOUR money.

---

## Capabilities

### A. Invoice Generation

- **Auto-generate from completed job** — tech marks job complete in Jobber/ST → invoice agent creates invoice from time, materials, and rate data
- **Rate application** — applies the right rate: standard, after-hours, emergency, contract/agreed rate, prevailing wage
- **Material markup** — applies your markup rules (cost + 30%, or whatever your standard is)
- **Tax calculation** — jurisdiction-specific sales tax, knows what's taxable (labor often isn't, materials are, varies by state/city)
- **Flat rate vs T&M** — knows which pricing model applies to this job type or customer
- **Multi-line itemization** — breaks out labor, materials, equipment rental, permits, disposal fees, travel
- **Bundle/package pricing** — "Water heater install" as a flat rate line item instead of 47 individual lines
- **Change order incorporation** — approved change orders from the field get folded into the final invoice automatically
- **Progress billing** — for big jobs: milestone-based invoices (30% deposit, 40% rough-in, 30% completion)
- **Retainage handling** — hold back 5-10% per GC contract, track when it releases, invoice it separately
- **Warranty work detection** — "This job is within the warranty period of the original install — $0 invoice, log as warranty claim"
- **Credit/adjustment memos** — customer disputes partial amount, agent generates credit memo
- **Batch invoicing** — end of day/week, generate all invoices for completed jobs at once

### B. Invoice Delivery

- **Auto-send on approval** — or auto-send if under confidence/amount threshold (autonomy rules)
- **Delivery method per customer** — some want email, some want text, GCs want through their portal, property managers want through AppFolio/Yardi
- **GC pay application format** — GCs don't accept regular invoices. They need AIA G702/G703 pay applications. Agent generates in correct format
- **Backup documentation** — attach photos, signed completion form, permits, inspection results — whatever this customer/GC requires
- **Branded PDF** — your logo, your colors, professional layout
- **Customer portal link** — "Click to view and pay online" (if using Stripe/payment processor)
- **Duplicate detection** — "You already invoiced this job on March 3 — create another?"
- **Scheduled send** — "Don't send invoices to residential customers on weekends" (configurable)

### C. Payment Tracking

- **Payment status sync** — reads from QuickBooks/Stripe/payment processor: paid, partial, outstanding
- **Aging buckets** — current, 30, 60, 90, 120+ days
- **Payment application** — customer sends one check for 3 invoices, agent allocates correctly
- **Partial payment handling** — logs partial, updates balance, adjusts aging
- **Payment method tracking** — check, ACH, credit card, cash, financing — knows your preferences ("push customers to ACH, it's cheaper")
- **Deposit tracking** — deposit collected at estimate stage, applied to final invoice
- **Overpayment handling** — customer overpays → credit on account or refund?
- **NSF/returned check** — payment bounced → flag, re-bill, add fee if your terms allow
- **Payment receipt** — auto-sends receipt/thank you when payment received

### D. Revenue Recognition & Job Costing

- **Real-time margin per invoice** — "This job invoiced $2,400. Labor cost was $800, materials $600. Gross margin: 42%"
- **Margin alerts** — "This invoice is below your 35% margin threshold — review before sending?"
- **Actual vs estimated** — "Estimated $1,800, invoicing $2,400 — 33% over. Change order approved?" or "Estimated $3,000, invoicing $2,100 — you left $900 on the table"
- **Labor cost calculation** — hours × loaded rate (wage + burden + WC + benefits), not just raw wage
- **Unbilled revenue detection** — "You have 12 completed jobs with no invoice. That's $18,000 sitting on the table"
- **Revenue by category** — service vs install vs maintenance contract vs project work

### E. Recurring & Contract Invoicing

- **Maintenance agreement billing** — auto-invoice monthly/quarterly/annual maintenance contracts
- **Service agreement renewals** — "47 agreements expire this month — here are the renewal invoices"
- **Flat monthly retainer** — for customers on a monthly service plan
- **Escalation clauses** — "Contract says 3% annual increase — applied to this year's renewal"
- **Multi-property billing** — property manager has 20 buildings, consolidated or per-property invoicing?

### F. Compliance & Documentation

- **Lien waiver generation** — conditional waiver with invoice, unconditional waiver when paid (required by law in many states before payment)
- **Prevailing wage certified payroll attachment** — for public work, attach certified payroll to invoice
- **Sales tax reporting** — tracks taxable vs non-taxable by jurisdiction for quarterly filings
- **1099 tracking** — if you're being paid as a sub, tracks for your own tax reporting
- **Audit trail** — every change to every invoice logged: who, when, what changed
- **Retention schedule** — how long to keep invoice records (IRS says 7 years)

### G. Intelligence & Optimization

- **Optimal send time** — learns when each customer pays fastest ("Send to ABC on Monday mornings, they pay same week")
- **Payment prediction** — "Based on history, this customer pays in ~18 days"
- **Price optimization** — "Your average residential service call is $285. Market average is $340. You're leaving money."
- **Discount analysis** — "You gave $14,000 in discounts this quarter — here's the breakdown by customer, reason, and who authorized"
- **Write-off recommendations** — "Invoice #4521 is 180 days old, $450, customer unresponsive — write off?"

### H. Insurance & Home Warranty Invoicing

Completely different workflows. Different payer, different format, different timeline.

**Insurance restoration work (water damage, fire, storm):**
- Xactimate estimates — insurance industry standard, invoice must match Xactimate line items
- Supplement process — initial scope approved, find hidden damage, file supplement, get approval, then invoice
- Program pricing — if you're on an insurance company's preferred vendor program, rates are preset
- Mortgage company escrow — on large claims, check goes to homeowner AND mortgage company, both must endorse
- Depreciation recovery — insurance pays ACV first, RCV after completion, two-phase invoicing
- Customer deductible collection — insurance pays their part, YOU collect the deductible from the homeowner
- Documentation requirements — photos, moisture readings, equipment logs, drying logs — all attached to invoice

**Home warranty companies (AHS, First American, Choice, etc.):**
- Their rates, not yours — warranty company dictates what they pay for each repair type
- Service call fee — homeowner pays you $75-125 at the door, warranty company pays the rest
- Authorization required — can't do work without pre-auth, invoice rejected without auth number
- Their portal — submit invoices through THEIR system, not yours
- Slow pay — 30-60-90 days is normal, agent tracks separately
- Cash-out-of-pocket tracking — warranty company pays $400 for a job that costs you $600? Agent flags: "You lost $200 on this warranty job. Your average loss on AHS jobs is $150/job. Consider dropping this program."
- Buyout offers — warranty company offers homeowner cash instead of repair, you get nothing, agent tracks these

### I. GC/Commercial Complexity

Regular invoices don't work for GC work. It's a whole different system.

- **Schedule of Values (SOV)** — before you bill anything, you submit a breakdown of your contract price by line item. GC approves. Every invoice (pay application) references this
- **AIA G702/G703 format** — industry standard pay application forms. Agent generates these, not regular invoices
- **Stored materials billing** — bought $40K in copper for the job, it's sitting in the warehouse. You can bill for stored materials before installing. Agent tracks what's stored vs installed
- **Back charges** — GC charges YOU for damage, cleanup, schedule delays. Agent tracks, disputes if warranted, deducts from expected revenue
- **Pay-when-paid clauses** — GC doesn't pay you until owner pays them. Agent tracks upstream payment status when possible
- **Joint check agreements** — GC issues check to you AND your supplier jointly. Agent tracks these
- **Retention release** — separate invoice just for retained amounts, triggered by project milestones (substantial completion, final completion, warranty expiration)
- **Prompt Payment Act** — on public projects, law requires payment within X days (30 in NYC). Agent flags violations: "GC is 15 days late on Pay App #4 — Prompt Payment Act applies, interest accruing"

### J. Lien Rights Preservation

This is critical. If you don't preserve your lien rights, collections has zero leverage.

- **Preliminary notice** — in many states, you must send written notice to the property owner within X days of starting work (20 days in CA, not required in NY but recommended)
- **Notice to owner tracking** — agent auto-sends preliminary notice when a job starts, logs proof of delivery
- **Lien deadline tracking** — you have X days from last day of work to file a mechanic's lien (varies wildly by state: 30 days in some, 120 in others)
- **Lien waiver generation** — conditional waiver goes with every invoice, unconditional waiver goes with every payment received
- **Waiver tracking** — "You've been paid for 4 out of 6 invoices but only collected 3 unconditional waivers from your sub" — exposure alert
- **Chains to compliance** — lien rights are jurisdiction-specific, compliance agent provides the rules

### K. Multi-Entity & Tax Complexity

Many contractors have multiple business entities.

- **Multiple entities** — LLC for service work, S-corp for project work, different DBAs
- **Entity-correct invoicing** — agent knows which entity to invoice from based on job type, customer, or project
- **Tax ID per entity** — correct EIN on correct invoices
- **Sales tax jurisdiction** — where the WORK is performed, not where your office is (matters for multi-city contractors)
- **Tax exempt customers** — government, churches, nonprofits — agent flags and applies exemption
- **Sales tax on materials only** — most states don't tax labor, but some do. Rules vary by trade and job type
- **Resale certificates** — some material purchases are tax-exempt if resold to customer — agent tracks

### L. Recurring Revenue & Membership Programs

The modern trades business trend — subscription/membership model.

- **Membership plan billing** — "Priority Club: $19/month, includes annual tune-up, 15% off repairs, priority scheduling"
- **Auto-billing** — monthly/annual charges on stored payment method
- **Failed payment retry** — card declined → retry in 3 days → retry in 7 → notify customer → cancel after X failures
- **Plan tier management** — basic/premium/VIP with different benefits affecting invoice pricing
- **Membership discount application** — auto-applies member discount to service invoices
- **Churn tracking** — "12 members cancelled this month, $2,280/year lost MRR" → chains to customer agent
- **Revenue recognition** — prepaid annual memberships need to be recognized monthly (accrual accounting)

---

## Agent Chains

| Event | Chains To | What Happens |
|-------|-----------|-------------|
| Invoice created | **Finance** | Logs revenue, updates AR, cash flow forecast |
| Invoice unpaid > 30 days | **Collections** | Takes over the chase |
| Invoice margin below threshold | **Insights** | Flags for pricing review |
| Job complete, no invoice | **Field-ops** | "Is this job actually complete?" |
| GC pay app due | **Compliance** | Attach lien waivers, certified payroll |
| Maintenance agreement renewal | **Customer** | Renewal outreach, upsell |
| Payment received | **Finance** | Cash receipt, bank reconciliation |
| Invoice dispute | **Customer** | Flag relationship, track resolution |
| Lien deadline approaching | **Compliance** | Preserve lien rights |
| Insurance claim invoice | **Compliance** | Documentation requirements |
| Warranty job completed | **Inventory** | Parts used under warranty, track cost |
| Membership cancelled | **Customer** | Retention outreach |
| Back charge received from GC | **Finance** | Log expense, dispute if warranted |
| Preliminary notice deadline | **Compliance** | Send notice, preserve lien rights |
| Unbilled jobs detected | **Field-ops** | Verify completion status |
| Tax reporting period | **Finance** | Sales tax summary by jurisdiction |

---

## Autonomy Rules

| Action | Tier | Why |
|--------|------|-----|
| Generate invoice from completed job | AUTO | Deterministic math |
| Apply standard rates/markup/tax | AUTO | Configured rules |
| Send invoice under $X residential | AUTO | Low risk, high frequency |
| Send maintenance agreement billing | AUTO | Recurring, pre-approved |
| Generate lien waiver with invoice | AUTO | Always required |
| Send preliminary notice | AUTO | Legal protection, no downside |
| Retry failed membership payment | AUTO | Standard retry logic |
| Send invoice to GC / commercial | REVIEW | Higher stakes |
| Apply discount | REVIEW | Revenue impact |
| Generate credit memo | REVIEW | Reducing revenue |
| Invoice over/under estimate by >20% | REVIEW | Needs explanation |
| First invoice to new customer | REVIEW | Sets relationship |
| Generate AIA pay application | REVIEW | Complex, high dollar |
| File supplement on insurance job | REVIEW | Requires justification |
| Write off invoice | ESCALATE | Financial loss |
| Dispute GC back charge | ESCALATE | Relationship + legal |
| Invoice from wrong entity | ESCALATE | Tax/legal risk |
