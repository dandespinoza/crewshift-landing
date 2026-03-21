# CLAUDE.md — Project Brief

> **Read this entire document before writing any code, making architectural decisions, or asking questions. This is the single source of truth for what we are building.**

---

## THE PIVOT

We built **CrewShift AI** — a back-office automation platform for trades and service businesses. It handled invoicing, estimating, collections, field ops, and workflow automation for contractors (plumbers, electricians, HVAC, GCs). We built AI agents that automated these tasks. The dashboard had a dark sidebar, white content area, orange (#F97316) accent color, and a clean card-based layout. That design system carries forward.

**We are pivoting.** Our contractor customers kept asking us to solve their compliance and permitting problems — violations from city agencies, permit confusion, missed deadlines, expensive expediters. The demand was loud and repeated. We are now building an **AI compliance platform for the construction and real estate industry.**

What carries forward from CrewShift:
- The design system (dark sidebar, white content, orange accents, Inter font, card-based UI)
- The AI agent infrastructure
- The existing contractor customer base (they become one of our four personas)
- Auth, user management, billing foundations

What is new:
- Everything else. New data model, new workflows, new integrations, new AI behavior, new core product.

---

## WHAT THIS PRODUCT DOES

Property owners, managers, contractors, and developers in cities like NYC deal with building violations from dozens of agencies — DOB, DEP, HPD, FDNY, ECB, DOT, Sanitation, 311, and more. When they get a violation, the current process is:

1. Receive a violation notice (often confusing, full of code references)
2. Hire an expediter ($5K–$10K per violation) who has relationships at the agencies
3. Expediter figures out what forms to file, what documents are needed, whether a licensed professional is required
4. Expediter submits paperwork, tracks the case, appears at hearings
5. Owner pays the fine, the expediter fee, the architect fee, the professional fees

**We replace steps 2–4 entirely.** The platform reads the violation, maps it to a resolution pathway, generates the required permits, identifies what professionals are needed, and tracks everything to dismissal. The knowledge that lives in an expediter's head — which form goes where, which agency handles what, what order to do things in — we encode that into software.

---

## THE FOUR USERS

### Property Managers
Manage 5–200+ properties across multiple agencies. Violations pile up. Deadlines overlap. They pay expediters per property per violation. They need portfolio-wide monitoring, bulk resolution, deadline intelligence. **Highest lifetime value. Most likely to be on Portfolio ($599/mo) or Unlimited ($1,299/mo) plan.**

### Property Owners
Individual landlords or small owners with 1–5 properties. They get a violation and don't understand it. They need plain-English breakdown, step-by-step resolution, permit generation, court date tracking. **Highest volume. Most likely on Solo ($199/mo) plan. Many convert to Portfolio as they add properties.**

### Contractors
Plumbers, electricians, GCs. They need to know permit requirements before starting work — not after DOB shows up. When a violation hits because of their work, they need to resolve it fast to protect the client relationship. **Our existing CrewShift customers. Immediate pipeline. They treat each job site as a "property" in our system.**

### Developers
Running multi-agency projects (DOB, DEP, FDNY, DOT simultaneously). Need project-to-permit mapping, multi-agency approval tracking, construction-phase compliance monitoring, pre-certificate-of-occupancy violation sweeps. **Highest contract value per account.**

---

## PRICING & BILLING

Self-serve. No sales calls. Sign up, pick plan, enter card.

```
Solo        $199/mo    Up to 3 properties     2 seats
Portfolio   $599/mo    Up to 25 properties    10 seats
Unlimited   $1,299/mo  Unlimited properties   Unlimited seats
```

Annual billing: 20% discount.

**Free hook:** The first violation upload and resolution plan is completely free. No card required. The user uploads a real violation, sees the AI extract it, sees the resolution plan, sees the permits, sees the timeline. The paywall triggers when they want to:
- Track the case over time
- Add additional violations
- Access the full dashboard
- Use proactive scanning
- Add team members

**All paid plans include everything.** No feature gating between tiers. The only variable is property count and seat count. This is critical — do not build feature flags per tier. The unlock is purely property count + seats.

**Billing logic:**
- Monthly billing by default
- Annual billing toggle on pricing page (shows monthly price with 20% discount)
- Stripe integration for payment processing
- Upgrade/downgrade at any time, prorated
- Usage tracking: count of active properties (a property is "active" if it has at least one case or has been added to the dashboard)

---

## THE PRODUCT — SCREEN BY SCREEN

### Design System

Carry forward from CrewShift:
- **Sidebar:** Dark (#111111), 220px wide
- **Content area:** Light (#FAFAFA background, white cards)
- **Primary accent:** Orange (#F97316)
- **Hover accent:** Darker orange (#EA580C)
- **Font:** Inter (weights 300–700)
- **Mono font:** JetBrains Mono (for case IDs, violation codes, property data)
- **Card style:** White background, 1px #EBEBEB border, 12px border radius, hover turns border orange
- **Badges:** Rounded pills with colored backgrounds (red for critical/open, yellow for major/in-progress, green for ready/resolved, purple for needs-professional, gray for unassigned)
- **Buttons:** Primary = orange bg white text, Secondary = white bg gray border

### Navigation (Sidebar)

```
[Logo: ComplianceAI]                    ← or whatever the name becomes

[■ Start New Case]                      ← orange button, always visible at top

---
Dashboard                               ← /dashboard
Cases                                   ← /cases
Properties                              ← /properties
Permits                                 ← /permits
Communication                           ← /communication

---
Settings                                ← /settings (bottom)

---
[User avatar + name]                    ← bottom of sidebar
[Company name]
```

### Dashboard (/dashboard)

**Top bar:** "Dashboard" title + company name subtitle

**Greeting:** "Good [morning/afternoon], [First Name]" + current date

**Summary cards (4 across):**
1. Open Violations — count + "across X agencies"
2. Pending Permits — count + "X ready to file"
3. Pending Assignments — count + "X urgent"
4. Total Exposure — dollar amount + "in potential fines"

**AI Suggestions panel:**
- Orange left border on white card
- "✨ AI Suggestions" header
- List of 3–5 actionable recommendations, each with:
  - Colored priority dot (red/yellow/orange)
  - One-line description of what needs attention
  - Action link text in orange ("Assign now →", "File permit →", "Prepare packet →")
- Each suggestion links to the relevant case/violation/permit

**Recent Cases table:**
- Columns: Case ID (mono font, orange, clickable), Property, Violations (count badge), Status (badge), Exposure (red if >$10K), Deadline (yellow if <30 days)
- Rows are clickable → navigates to case detail

### Start New Case Flow (/cases/new)

This is a **Typeform-style flow** — one question per screen, smooth transitions, progress dots at top.

**Top bar:** "New Case" + progress dots (4 dots, filling orange as you advance) + "Cancel" button

**Step 1 — "What can I help you with?"**
- Subtitle: "Select the type of issue you're dealing with."
- Four clickable cards:
  - ⚠️ "I received a violation" → "Upload a notice and we'll build your resolution plan"
  - 📄 "I need a permit" → "We'll identify requirements and guide you through filing"
  - 🔍 "Upcoming inspection" → "Prepare your property and get a pre-inspection checklist"
  - 💬 "General compliance question" → "Ask anything about codes, agencies, or filings"
- Clicking a card auto-advances to Step 2

**Step 2 — "What property is this for?"**
- Text input for address (with autocomplete if possible)
- Below: "YOUR PROPERTIES" section showing previously saved properties as selectable cards
- Selecting or entering advances to Step 3
- If it's a new address, we create a new property record

**Step 3 — "Upload the violation notice"**
- Large drag-and-drop zone
- Accepts: PDF, JPG, PNG, HEIC, TIFF
- On upload: shows filename, file size, orange checkmark
- "Continue" button appears after upload

**Step 4 — "Anything else we should know?"**
- Textarea placeholder: "e.g. Contractor did plumbing work without pulling a permit. DOB showed up and issued this. Court date is April 15th, need to resolve ASAP…"
- Two buttons: "Analyze & Build Case" (primary orange) + "Skip" (secondary)

**After submission → Analyzing Screen**

### Analyzing Screen (/cases/new/analyzing)

Full-screen centered loading experience. Not a spinner — a step-by-step reveal showing the AI working.

**Center icon:** 🔍 in an orange-tinted container (switches to ✅ when complete)

**Title:** "Analyzing violation…" → "Case ready" when complete

**Subtitle:** "Extracting codes and building your resolution plan" → "X violations identified • X permits generated"

**Step list (each animates in sequence, ~850ms per step):**
1. "Extracting violation details from image…"
2. "Identifying violation codes & issuing agency…"
3. "Cross-referencing [AGENCY] records…"  ← dynamic based on detected agency
4. "Checking property: [ADDRESS]…"  ← dynamic based on detected/entered address
5. "Property found — mapping existing history…"
6. "X violations identified across [AGENCIES]…"
7. "Matching violations to resolution pathways…"
8. "Generating required permits & action steps…"
9. "Building compliance case…"

Each step: circle indicator (empty → orange dot when active → orange checkmark when complete), text fades from gray to orange (active) to black (complete).

**What's actually happening during this screen (backend):**

```
1. OCR/Vision model extracts text from uploaded document
2. NLP parses: violation number, code section, agency, address, penalty, dates, respondent
3. Address lookup → match to existing property in user's account, or query public records
4. Public data pull: BIS/DOB NOW/HPD Online/DEP (depending on city) for:
   - Existing open violations on this property
   - Permit history
   - Complaint history
   - Building classification, BIN, block/lot, owner of record
5. Resolution engine: violation code → lookup in knowledge graph → resolution pathway
6. Permit generation: resolution pathway → required permits → generate checklist + packet
7. Professional identification: which permits require licensed professionals → flag and type
8. Case creation: all data assembled into case record with stages
```

After completion (1–2 second delay after last step) → auto-navigate to Case Detail.

### Case Detail (/cases/:caseId)

**Header section:**
- Case ID badge (orange bg, mono font, e.g., "CASE-001")
- Property address (bold, primary text)
- Property metadata line: BIN, Block, Lot, Building type, Owner name (orange)
- Right side: "Export" button (secondary) + "+ Add Violation" button (primary orange)

**Tabs (horizontal, underline-style, below header):**
- Violations (with count badge)
- Permits (with count badge)
- Follow-ups (with count badge)
- Tracker

#### Violations Tab

**Summary cards (4 across):**
1. Open Violations — count
2. Total Exposure — dollar amount
3. Next Deadline — date + "X days left"
4. Court Date — date + "ECB Hearing" or similar

**Violation cards (stacked vertically):**
Each card contains:
- **Top row left:** Violation ID (mono font, gray bg pill) + Agency badge (gray bg pill)
- **Top row right:** Severity badge (Critical=red, Major=yellow, Moderate=blue) + Status badge (Open=red, In Progress=yellow)
- **Title:** Human-readable violation name + "— §[code]" in gray
- **Description:** Plain-English explanation of what the violation means
- **Bottom row:** Penalty amount (red bold), Issued date, Deadline (yellow bold if approaching)
- **Hover:** Border turns orange. Entire card is clickable → could expand or navigate to violation detail.

#### Permits Tab

**Permit cards (stacked vertically):**
Each card contains:
- **Header:** Permit type name (bold) + Status badge (Ready to File=green, Needs Professional=purple, Documents In Progress=yellow)
- **Subheader:** "For: [VIOLATION-ID] • Agency: [AGENCY]"
- **Requirements section:** Label "REQUIREMENTS" (uppercase, small, gray) + checklist items with empty checkboxes. Each item is a required document, sign-off, or action.
- **Footer:** Estimated cost range + Estimated timeline
- Checkboxes are interactive — user can check off completed items

**Bottom of page:** "📦 Generate Full Permit Packet" button (primary orange). This compiles all permit requirements, checklists, and instructions into a downloadable PDF.

#### Follow-ups Tab

**Info banner:** Orange bg, "💡 X professionals needed to resolve your open violations. Assign from your network or let us connect you."

**Professional cards (stacked vertically):**
Each card contains:
- **Left side:** Professional role (bold, e.g., "Licensed Master Plumber") + Priority badge (Urgent=red dot, High=yellow dot, Medium=blue dot)
- **Below:** Reason (why this professional is needed, e.g., "Required for PW1 permit sign-off")
- **Below:** "Links to: [VIOLATION-ID]" in gray
- **Right side:** "Assign" button (secondary, turns orange on hover)

Clicking "Assign" should open a flow to either:
- Enter contact info for someone from the user's network
- (Future) Browse the professional marketplace

#### Tracker Tab

**Progress bar:** "Overall Progress" label + "X / Y complete" + horizontal progress bar (orange fill)

**Vertical timeline with phases:**

Each phase is a node on a vertical line:
- Circle icon (orange filled with checkmark if all items done, white with phase icon if not)
- Vertical line connecting to next phase (orange if phase complete, gray if not)
- Card to the right with:
  - Phase name (bold) + "X/Y" count
  - Checklist items with checkbox states (orange filled checkbox = done, empty = not done)
  - Item text (gray strikethrough if done, black if not)

**Phases in order:**
1. Violation Received — items: one per violation identified
2. Documents & Permits — items: one per permit application + "Owner authorization letters"
3. Professional Assignments — items: one per professional needed
4. Agency Submission — items: one per permit to be filed at an agency
5. Resolution & Dismissal — items: ECB hearings, completion certs, compliance confirmations

### Properties (/properties)

List of all properties the user has added. Each property card shows:
- Address
- Open violation count
- Total exposure
- Last activity date
- Status indicator

Clicking a property → shows all cases for that property, or property detail view.

### Permits (/permits)

Aggregate view of all permits across all properties. Filterable by status, agency, property. This gives property managers a portfolio-wide view of permitting status.

### Communication (/communication)

Thread-based messaging. One thread per case. All parties assigned to a case (owner, contractor, architect, inspector) can see and post in the thread. Shows what's needed, what's done, what's next.

### Settings (/settings)

- Account info
- Company info
- Team members / seat management
- Billing / plan management
- Notification preferences
- Property management (add/remove properties)

---

## THE RESOLUTION ENGINE — HOW IT WORKS

This is the core intellectual property. It is a knowledge graph that maps violation codes to resolution pathways, per agency, per city.

### Data structure concept:

```
ViolationCode {
  code: "28-105.1"
  agency: "DOB"
  city: "NYC"
  title: "Work Without Permit"
  description_template: "Interior/exterior work performed without active {permit_type} permit."
  severity: "Major"
  penalty_range: { min: 5000, max: 25000 }
  penalty_per_diem: true/false
  escalation_rules: "Penalty doubles after 60 days. Default judgment if hearing missed."
  
  resolution_pathway: {
    steps: [
      {
        order: 1
        action: "Obtain required permit"
        permit_type: "PW1" // or whichever applies
        requires_professional: { type: "Licensed Master Plumber", license: "P-1" }
        documents_needed: ["Plumbing plan drawings (PE stamped)", "Owner authorization letter"]
        filing_portal: "DOB NOW"
        estimated_cost: { min: 1200, max: 2400 }
        estimated_timeline: "2–4 weeks"
      },
      {
        order: 2
        action: "Submit correction to DOB"
        documents_needed: ["Completed PW1 application", "Professional sign-off"]
        filing_portal: "DOB NOW"
      },
      {
        order: 3
        action: "Attend ECB hearing or request dismissal"
        details: "If work is corrected and permit obtained, request dismissal at hearing. Bring proof of correction."
      }
    ]
  }
}
```

### How resolution mapping works at runtime:

1. AI extracts violation code from uploaded document
2. Code is looked up in the knowledge graph for that city + agency
3. Resolution pathway is retrieved
4. Each step in the pathway generates:
   - A permit record (if applicable) with checklist
   - A professional assignment record (if applicable)
   - A tracker stage item
5. All of this is assembled into the case

### Building the knowledge graph:

For MVP, we manually encode the most common violation types in NYC. There are roughly 50–100 violation codes that cover 90%+ of what property owners actually encounter. We start with:

**DOB (Department of Buildings):**
- 28-105.1 — Work without permit
- 28-302.1 — Failure to maintain (facades, Local Law 11)
- 28-210.1 — Failure to comply with DOB order
- 28-301.1 — Failure to maintain building
- Various electrical, plumbing, construction safety codes

**HPD (Housing Preservation & Development):**
- Class A, B, C housing violations (heat, hot water, mold, pests, lead paint)
- Each class has different severity and timeline requirements

**DEP (Department of Environmental Protection):**
- Stormwater violations
- Sewer connection violations
- Backflow prevention

**FDNY:**
- Fire alarm violations
- Sprinkler violations
- Means of egress

**ECB (Environmental Control Board):**
- The hearing/adjudication body — not a separate violation source, but cases from DOB/DEP/FDNY/Sanitation get heard here

Over time, the knowledge graph expands:
- More violation codes per city
- More cities (each city has its own codes and agencies)
- AI-assisted expansion: when we encounter a violation code that's not in the graph, the AI researches it and proposes a resolution pathway for human review

---

## DATA SOURCES & INTEGRATIONS

### NYC (Launch Market)

**DOB BIS (Building Information System):**
- Property lookup by address, BIN, block/lot
- Violation history, permit history, complaint history
- Building classification, owner of record
- Access: Web scraping + bulk data downloads (no clean REST API)
- URL patterns: `http://a810-bisweb.nyc.gov/bisweb/...`

**DOB NOW:**
- Newer portal, some data available
- Where permits are filed electronically
- Access: Limited API, mostly web portal

**HPD Online:**
- Housing violations, complaints, registrations
- Access: Some Socrata datasets + web portal
- Dataset: violations, complaints, registrations by address

**ECB/OATH:**
- Hearing results, penalties, case status
- Access: Web portal, some bulk data

**DEP:**
- Environmental violations
- Access: Web portal

**NYC Open Data (Socrata):**
- Various datasets on data.cityofnewyork.us
- SODA API for programmatic access to available datasets
- Not comprehensive for all agencies but useful supplement

### Expansion Cities (Socrata-based)

These cities run on Socrata and have the same SODA API pattern. Once we build a Socrata connector, adding a new city is mostly field mapping:

LA (data.lacity.org), Chicago (data.cityofchicago.org), San Francisco (data.sfgov.org), San Diego (data.sandiegocounty.gov), Seattle (data.seattle.gov), New Orleans (data.nola.gov), Austin (data.austintexas.gov), Denver, Dallas, Washington DC (opendata.dc.gov), Portland, Minneapolis

### Other expansion cities (open data, non-Socrata):

Philadelphia (opendataphilly.org), Boston (data.boston.gov — CKAN), Miami (miami.gov/Developer), Baltimore, Pittsburgh, Detroit, Nashville, Kansas City, Louisville, St. Louis, Oakland, Sacramento, San Jose, Fort Worth, Columbus, Charlotte, Indianapolis, Tampa, Atlanta, Raleigh, Tucson, Tempe, Mesa, Newark, Jersey City

### Integration architecture:

```
[Public Agency Data Sources]
        ↓
[Data Ingestion Layer]          ← City-specific adapters (Socrata adapter, scraper adapter, bulk download adapter)
        ↓
[Normalized Property Database]  ← Unified schema across all cities
        ↓
[Resolution Engine]             ← Knowledge graph lookup
        ↓
[Case/Permit/Assignment Records] ← User-facing data
        ↓
[Dashboard / API]
```

Each city has an adapter that normalizes agency data into our unified schema. The adapter handles the city-specific quirks (different field names, different violation code formats, different agency structures). Everything downstream of the normalized database is city-agnostic.

---

## AI AGENT BEHAVIOR

### Violation Extraction Agent

**Input:** Uploaded document (image or PDF)
**Process:**
1. OCR if image, text extraction if PDF
2. NLP extraction of structured fields:
   - Violation number/ID
   - Code section (e.g., "28-105.1")
   - Issuing agency
   - Property address
   - Penalty amount
   - Hearing/compliance date
   - Respondent name
   - Description of violation
3. Confidence scoring on each field
4. If confidence is low on any field, flag for user confirmation

**Output:** Structured violation record

### Resolution Mapping Agent

**Input:** Structured violation record + city identifier
**Process:**
1. Look up violation code in knowledge graph
2. If exact match found → return resolution pathway
3. If no exact match → AI researches the code using:
   - Agency code documentation (scraped/indexed)
   - Similar violation codes in the graph
   - Historical resolution data from past cases
4. Propose resolution pathway for human review if it's a new code
5. Generate permits from pathway
6. Identify professional requirements

**Output:** Complete resolution pathway + permit records + professional requirements

### Proactive Scanning Agent

**Input:** Building photos (exterior, interior, common areas)
**Process:**
1. Computer vision analysis against known violation visual patterns:
   - Facade cracking/spalling (Local Law 11)
   - Missing/damaged fire escapes
   - Illegal signage
   - Unpermitted exterior alterations
   - Sidewalk damage
   - Missing/expired posted permits
   - Blocked egress
   - Improper scaffolding/construction fencing
2. Each detected issue mapped to likely violation code
3. Severity assessment
4. Resolution pathway generated (same as reactive flow)

**Output:** List of flagged issues, each with violation code, penalty estimate, and recommended action

### AI Suggestions Agent

**Input:** User's full portfolio state (all properties, violations, permits, deadlines, assignments)
**Process:**
- Deadline proximity alerts (approaching deadlines ranked by days remaining and penalty severity)
- Permit readiness alerts (permits where all requirements are met → "ready to file")
- Escalation warnings (violations where penalties increase if not addressed by date X)
- Portfolio prioritization (rank all open items by urgency × financial exposure)
- Professional coordination prompts (professionals assigned but not yet engaged)

**Output:** Ranked list of recommendations with action links, displayed on dashboard

---

## DATABASE SCHEMA (CONCEPTUAL)

```
Users
  id, email, name, company_name, role, created_at

Teams (multi-seat)
  id, name, plan_tier, property_limit, seat_limit, stripe_customer_id, stripe_subscription_id

Properties
  id, team_id, address, city, state, zip, bin, block, lot, building_class, owner_of_record, status, created_at

Cases
  id, team_id, property_id, case_number (auto-generated), type (violation/permit/inspection/general), status (open/in_progress/submitted/hearing/resolved/dismissed), created_at, created_by

Violations
  id, case_id, property_id, violation_number, code_section, agency, title, description, severity (critical/major/moderate), penalty_amount, penalty_per_diem, issued_date, compliance_deadline, hearing_date, hearing_location, status (open/in_progress/resolved/dismissed), raw_document_url, extracted_data (JSON), confidence_scores (JSON)

Permits
  id, case_id, violation_id, permit_type, agency, status (not_started/documents_in_progress/ready_to_file/submitted/approved), requirements (JSON array of {description, completed boolean}), estimated_cost_min, estimated_cost_max, estimated_timeline, filing_portal_url, packet_document_url

ProfessionalAssignments
  id, case_id, violation_id, permit_id, role (licensed_master_plumber/architect/pe/qewi_inspector/etc), reason, priority (urgent/high/medium), status (needs_assignment/assigned/in_progress/completed), assigned_to_name, assigned_to_contact, assigned_at

TrackerItems
  id, case_id, phase (violation_received/documents_permits/professional_assignments/agency_submission/resolution_dismissal), description, is_completed, completed_at, due_date

Messages (Communication)
  id, case_id, sender_id, sender_name, sender_role, content, created_at, attachments (JSON)

PropertyRecords (cached from public data)
  id, property_id, city, agency_source, data (JSON), last_synced_at

ResolutionGraph (the knowledge graph)
  id, city, agency, violation_code, title, description_template, severity, penalty_range (JSON), escalation_rules, resolution_steps (JSON array), requires_professionals (JSON array), related_permit_types (JSON array), created_at, last_verified_at

AISuggestions
  id, team_id, type (deadline_alert/permit_ready/escalation_warning/priority_recommendation), title, description, action_url, priority, is_dismissed, created_at

AuditLog
  id, team_id, user_id, action, entity_type, entity_id, details (JSON), created_at
```

---

## MULTI-CITY ARCHITECTURE

The system must support multiple cities from the start, even though we launch with NYC only. Every piece of data is tagged with a city identifier. The resolution engine queries by city + agency + violation code.

**Adding a new city requires:**
1. Building the data adapter (Socrata = fast, scraping = slower)
2. Mapping the city's agency names and structures to our normalized schema
3. Building the resolution graph for that city's most common violation codes (start with top 50)
4. Testing extraction accuracy on sample violations from that city
5. Enabling the city in the UI (city selector on property creation)

**Do not hardcode anything to NYC.** Every agency reference, every portal URL, every code format must be parameterized by city. If you find yourself writing "DOB" as a string literal, abstract it behind a city → agency mapping.

---

## WHAT SUCCESS LOOKS LIKE

**Month 3:** 90 customers, $27K MRR, NYC only, resolution engine covers top 50 NYC violation types
**Month 6:** 257 customers, $95K MRR, 6 cities, 2,500+ violations processed
**Month 12:** 741 customers, $329K MRR, 12 cities, 14,000+ violations processed
**Year 2:** 2,400 customers, $1.25M MRR, 24 cities
**Year 3:** 5,500 customers, $3.24M MRR, 38 cities

---

## IMMEDIATE BUILD PRIORITIES (IN ORDER)

1. **Violation upload + AI extraction** — the user can upload a document and get structured data back
2. **Resolution engine with 20 NYC violation codes** — the top 20 most common DOB/HPD/ECB violations mapped to resolution pathways
3. **Case creation and case detail view** — full UI with violations, permits, follow-ups, tracker tabs
4. **Dashboard** — portfolio view with summary cards, AI suggestions, recent cases
5. **Property management** — add/manage properties, link cases to properties
6. **New case Typeform flow** — the step-by-step intake
7. **Permit generation** — downloadable checklist/packet per violation
8. **Billing integration** — Stripe, plan selection, paywall after free first violation
9. **Deadline tracking + notifications** — email/SMS alerts for approaching deadlines and court dates
10. **Proactive scanning** — photo upload + computer vision analysis (can be later phase)

---

## TECHNICAL NOTES

- The analyzing screen steps are partially theatrical — some happen fast (OCR, extraction) and we pace the UI to build trust and show the user what's happening. Don't rush the animation even if the backend finishes faster.
- Violation documents should be stored permanently (S3 or equivalent). They are legal documents and users will need to reference them.
- The knowledge graph (ResolutionGraph) should be editable through an internal admin interface. We will be adding violation codes regularly as we encounter new ones.
- All violation data from public sources should be cached and refreshed on a schedule (daily or weekly depending on source). Do not make live calls to agency portals on every user request.
- The free first violation must feel like the full product — not a degraded version. Same extraction, same resolution plan, same permit generation. The only thing gated is persistence and the dashboard.
