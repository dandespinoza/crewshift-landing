# Collections Agent — Full Scope

The collections agent is your AI accounts receivable enforcer. It picks up where the invoice agent stops. Invoice agent sends the bill and tracks payment. Collections agent takes over when payment is late and works it until the money comes in or you've exhausted every option.

CrewShift doesn't make the phone calls or negotiate the relationships. It arms the owner with everything they need, drafts the communications, tracks the process, and makes sure nothing falls through the cracks. The human handles the relationship. The AI handles everything around it.

---

## The Core Job

A contractor does the work, sends the invoice, and doesn't get paid. This happens constantly. The owner doesn't have time to chase money, feels awkward about it, or doesn't know the right escalation steps. So invoices age, cash flow suffers, and eventually the money is gone. The average trade contractor has 15-25% of their revenue sitting in AR over 30 days. That's money they've already spent labor and materials on.

---

## Capabilities

### A. Aging & Priority Management

- **Automatic takeover** — invoice hits 30 days (or configured threshold), collections agent activates. No manual handoff
- **Priority scoring** — not all overdue invoices are equal. Score by: amount, age, customer history, likelihood to pay, relationship value, lien deadline proximity
- **Segmentation** — residential vs commercial vs GC vs property manager vs government. Each has different collection strategies and timelines
- **Dashboard** — total AR, aging buckets (30/60/90/120+), trend (growing or shrinking?), biggest offenders, at-risk amounts
- **Cash flow impact** — "You have $47K in AR over 60 days. Your payroll is $22K on Friday. You need to collect $X this week."

### B. Automated Outreach Sequences

Different customer types get different sequences. Not one-size-fits-all.

**Residential:**
- Day 30: Friendly reminder email/text ("Just a reminder, invoice #1234 is outstanding")
- Day 37: Second reminder, slightly more direct
- Day 45: Phone call prompt to owner with talking points and customer context (PREPARE tier, human makes the call)
- Day 60: Formal past-due notice (letter, more serious tone)
- Day 75: Final notice before further action
- Day 90: Decision point: small claims, collections agency, or write off

**Commercial/GC:**
- Day 30: Reminder to AP contact (not the project manager, the person who cuts checks)
- Day 35: Follow up with project manager AND AP
- Day 45: Escalate to GC's senior management contact. Agent prepares context and talking points, owner makes the call
- Day 60: Formal demand letter citing contract payment terms
- Day 75: Prompt Payment Act notice (if public work)
- Day 90: Lien filing preparation, attorney referral

**Property Manager:**
- Day 30: Reminder through their portal (AppFolio, Yardi, Buildium) + email
- Day 45: Escalate to property owner (not just manager). Agent surfaces contact info and prepares context
- Day 60: Withhold future service until paid ("We have a service call scheduled for Building B next week. Account is past due.")

**Sequence behavior:**
- **Tone escalation** — each touchpoint gets progressively more formal and direct, but never aggressive. Professional persistence
- **Channel rotation** — if email isn't working, try text. If text isn't working, prompt a phone call. If phone isn't working, send a letter
- **Time of day optimization** — learn when each customer is most responsive
- **Holiday/weekend awareness** — don't send collection notices on holidays

### C. Payment Negotiation & Flexibility

Sometimes you need to work with the customer to get paid. The agent prepares the options and tracks the outcome. The owner has the conversation.

- **Payment plan preparation** — "Can't pay $4,500 today? Here are 3 options to offer: $1,500/month for 3, $900/month for 5, or $2,250 now + $2,250 in 30 days"
- **Payment plan tracking** — monitor plan compliance, alert on missed installments
- **Early payment incentives** — "Pay within 7 days, take 3% off the balance"
- **Partial payment acceptance** — take what they can pay now, track the remainder
- **Dispute preparation** — customer says "the work wasn't right" or "that's not what I agreed to." Agent pulls job records, photos, signed estimates, change orders, and completion sign-offs. Prepares a fact-based response for the owner to use in the conversation
- **Credit card on file charging** — if authorized, charge the card on file after X days past due
- **Autopay enrollment push** — "To avoid future late payments, would you like to set up autopay?"
- **Courtesy adjustments** — suggest small adjustments to close out stubborn invoices ("Write off $50 on a $2,300 invoice to get it paid this week?")
- **Relationship context** — before any escalation, agent surfaces: "This customer has sent you $45K in work this year and always pays within 45 days. This one is 50 days. Probably not worth escalating hard." The human makes the judgment call

### D. Lien Rights & Legal Escalation

When nice doesn't work, you need leverage. The agent prepares everything. The owner or attorney executes.

- **Lien deadline tracking** — "You have 47 days left to file a mechanic's lien on this property. After that, you lose your right."
- **Preliminary notice verification** — "Did we send the preliminary notice? If not, lien rights may already be gone." Chains to invoice agent/compliance
- **Notice of Intent to Lien** — the letter you send BEFORE filing. Often gets people to pay because a lien clouds their title. Agent drafts, owner reviews and sends. "This letter alone collects 40% of the time."
- **Lien filing preparation** — generates lien documents with property info, amount owed, work dates. Packages for attorney filing
- **Lien release on payment** — payment received, auto-generate lien release document
- **Small claims court prep** — for amounts under the threshold (varies by state: $5K-$10K), generates filing documents and evidence packet
- **Collections agency referral** — when internal efforts are exhausted, packages the account for handoff to a third-party collections agency with all documentation
- **Attorney referral** — for large amounts or complex disputes, packages full history for attorney review
- **Bond claim preparation** — on bonded projects, you can claim against the GC's payment bond. Agent identifies bonded projects and prepares bond claim documentation
- **Joint check demand** — if sub isn't paying your sub-sub, demand joint checks from the GC. Agent drafts the demand

### E. Customer Risk & Credit Management

Know who's risky before you do the work.

- **Payment history scoring** — every customer gets a payment score based on: average days to pay, number of late payments, disputes, partial payments
- **New customer risk flag** — "First job for this customer. No payment history. Consider requiring deposit or COD."
- **Credit limit tracking** — "This customer has $12K in open invoices. Your credit limit for them is $15K. This new job would put them at $18K. Require deposit?"
- **Bad debt pattern detection** — "Customers from this lead source (home warranty referrals, Angie's List, etc.) have 3x the collection rate of referral customers"
- **Customer blacklist** — "This customer has been sent to collections twice. Require prepayment or decline the work."
- **Industry data** — commercial customers: "This GC has 7 mechanic's liens filed against them in the last year. Require payment upfront or weekly."
- **Seasonal patterns** — "This property manager always pays late in Q1. Front-load their collection outreach."
- **Relationship value weighting** — "This customer is slow pay but gives you $80K/year. Different strategy than a one-time $500 invoice." Agent surfaces this context, owner decides approach

### F. GC/Commercial-Specific Collections

GC collections is a completely different game than residential.

- **Pay application tracking** — "Pay App #3 was submitted 35 days ago. Contract says net 30. Follow up with AP."
- **Retention tracking** — "You have $45K in retention across 6 projects. 2 projects are past substantial completion. File retention release invoices."
- **Prompt Payment Act enforcement** — on public work, statutory payment timelines apply. Agent tracks and generates formal notices citing the statute
- **Conditional vs unconditional waiver tracking** — "GC is demanding unconditional waiver before paying. You should only provide conditional until check clears."
- **Back charge disputes** — GC deducted from your payment. Agent pulls documentation to dispute: "Back charge of $2,300 for 'site cleanup' but your contract doesn't include general cleanup. Here's the scope section."
- **Pay-when-paid pushback** — "GC says they'll pay when owner pays. In most states, pay-when-paid is not enforceable after a reasonable time. Here's the law for your state."
- **Escalation up the chain** — GC not paying? Contact the owner/developer directly. Agent identifies the right contact and prepares the outreach. Owner makes the call
- **Cross-project leverage** — "This GC owes you on 3 projects. Consider withholding work on the new project until past invoices are settled." Agent surfaces the strategy, owner decides

### G. Government & Institutional Collections

Government pays slow but they always pay. Different process.

- **Purchase order tracking** — government work requires POs. Agent tracks PO status, approval, and payment
- **Warrant/check processing time** — government doesn't pay by ACH or credit card. Paper checks with processing time. Agent accounts for this
- **Budget cycle awareness** — "City fiscal year ends June 30. Invoices not processed by May are at risk of budget carryover delays."
- **Contact rotation** — government AP departments have high turnover. Agent tracks current contacts
- **Freedom of Information requests** — if payment is unreasonably delayed, agent prepares FOIL/FOIA request for payment status

### H. Insurance & Warranty Company Collections

Different beast. They have their own rules.

- **Insurance supplement tracking** — "Initial claim paid. Supplement submitted 45 days ago. Follow up with adjuster."
- **Depreciation recovery tracking** — "ACV paid on claim. Work complete. File for recoverable depreciation."
- **Home warranty payment tracking** — warranty companies pay 30-60-90 days. Agent tracks each authorization and payment status
- **Warranty company dispute** — "AHS denied payment for XYZ. Here's the authorization number and scope that was approved. File dispute."
- **Program compliance** — some insurance/warranty programs drop you if you dispute too aggressively. Agent surfaces this context so owner can decide how hard to push

### I. Write-Off & Bad Debt Management

When the money isn't coming.

- **Write-off recommendations** — based on age, amount, likelihood of collection, cost of continued pursuit
- **Write-off approval workflow** — agent recommends, owner approves, finance agent logs the bad debt
- **Tax implications** — "Writing off $4,500 in bad debt. Make sure your accountant records this for tax deduction."
- **Customer account status** — written-off customer flagged: prepayment required for future work, or blacklisted entirely
- **Recovery tracking** — sometimes written-off accounts pay later. Agent tracks and applies payment to the old balance
- **Bad debt trends** — "Your bad debt rate is 3.2% this year, up from 1.8% last year. Primary cause: home warranty company nonpayment."

### J. Reporting & Analytics

Understanding collection performance.

- **Collection effectiveness** — what percentage of overdue invoices are you actually collecting?
- **Days Sales Outstanding (DSO)** — how many days on average to get paid. Trending?
- **Outreach effectiveness** — which channel/message gets the most payments?
- **Customer cohort analysis** — residential vs commercial vs GC collection rates
- **Aging trend** — is your AR aging improving or deteriorating?
- **Cash recovered this month** — total collected on past-due invoices
- **Cost of collection** — time spent, fees paid, discounts given to collect
- **Lien filing effectiveness** — how often does a Notice of Intent to Lien result in payment?

---

## The AI/Human Line

The collections agent is where the AI/human boundary matters most. Money conversations are relationship conversations.

| AI Does | Human Does |
|---------|-----------|
| Sends automated reminders (early stage) | Makes the phone calls |
| Drafts formal notices and demand letters | Decides tone and timing for sensitive customers |
| Prepares talking points and customer context | Negotiates payment plans in real conversation |
| Tracks every touchpoint and deadline | Makes the judgment call on when to push vs when to wait |
| Calculates payment plan options | Reads the room, knows when someone is struggling vs avoiding |
| Surfaces relationship value context | Decides if the relationship is worth more than the invoice |
| Prepares lien/legal documents | Decides when to escalate to legal action |
| Packages accounts for attorney/agency | Manages the attorney/agency relationship |
| Logs outcomes and tracks follow-ups | Handles emotional/difficult conversations |

---

## Agent Chains

| Event | Chains To | What Happens |
|-------|-----------|-------------|
| Payment received on past-due | **Finance** | Cash receipt, AR update |
| Payment plan created | **Finance** | Scheduled revenue, cash flow forecast |
| Lien deadline approaching | **Compliance** | Lien filing preparation |
| Customer dispute on quality | **Customer** | Relationship management, resolution |
| Customer dispute on scope | **Estimate** | Pull original scope, change orders |
| Write-off approved | **Finance** | Bad debt expense logged |
| Customer blacklisted | **Customer** | Flag in CRM, require prepayment |
| Cross-project leverage needed | **Invoice** | Pull all open invoices for this customer |
| GC back charge dispute | **Estimate** | Pull original scope for defense |
| Retention release eligible | **Invoice** | Generate retention invoice |
| Bond claim needed | **Compliance** | Bond claim documentation |
| Payment collected affects cash flow | **Insights** | Revenue timing data |
| Bad debt trend increasing | **Insights** | Root cause analysis |
| New customer risk flag | **Estimate** | Require deposit on proposals |
| Home warranty nonpayment pattern | **Insights** | Program profitability analysis |
| Slow-pay customer requesting new work | **Field-ops** | Flag before scheduling |

---

## Autonomy Tiers

Five-tier model applied platform-wide. See docs for full tier definitions.

| Action | Tier | Why |
|--------|------|-----|
| Track payment plan compliance | AUTO | Monitoring |
| Update aging buckets and priority scores | AUTO | Internal calculation |
| Flag lien deadline approaching | AUTO | Critical alert |
| Sync payment status from accounting tools | AUTO | Data sync |
| Send friendly reminder at 30 days | COMMUNICATE | Routine, non-sensitive |
| Send follow-up reminders per configured schedule | COMMUNICATE | Pre-approved sequence |
| Send payment receipt on collection | COMMUNICATE | Operational confirmation |
| Send formal past-due notice at 60 days | REVIEW | Tone shift, relationship weight |
| Draft Notice of Intent to Lien | REVIEW | Legal action, relationship impact |
| Offer payment plan terms | REVIEW | Financial terms decision |
| Courtesy adjustment / write down | REVIEW | Revenue reduction |
| Charge card on file for past-due | REVIEW | Unilateral financial action |
| Withhold service until paid | REVIEW | Relationship and revenue impact |
| Prepare talking points for collection call | PREPARE | Human makes the call |
| Prepare customer context before GC escalation | PREPARE | Human has the conversation |
| Prepare dispute response with documentation | PREPARE | Human handles the negotiation |
| Assemble evidence packet for attorney/court | PREPARE | Human or attorney executes |
| File mechanic's lien | ESCALATE | Legal action |
| Refer to collections agency | ESCALATE | External escalation, cost, relationship |
| Refer to attorney | ESCALATE | Legal action, significant cost |
| Write off invoice | ESCALATE | Financial loss |
| Blacklist customer | ESCALATE | Losing future revenue |
| File bond claim | ESCALATE | Legal action against GC's bond |
