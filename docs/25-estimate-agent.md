# Estimate Agent — Full Scope

The estimate agent is your AI estimator and sales closer. It builds proposals, prices work, follows up until the customer says yes or no, converts approved estimates into contracts, and manages change orders throughout the job. It reads from your price book (in ServiceTitan/Jobber), your job history, material costs, and labor rates to produce professional proposals that win work.

CrewShift doesn't replace your field service tool. It's the intelligence layer that makes estimating faster, more accurate, and more profitable.

---

## The Core Job

A customer calls and says "I need a new water heater" or a GC sends plans and says "bid the plumbing." Someone needs to figure out what the work costs, what to charge, build a professional proposal, send it, and follow up. Most contractors either underprice (leaving money on the table) or take 3 days to send the estimate (customer already called someone else).

---

## Capabilities

### A. Estimate Creation

- **Auto-generate from job request** — customer describes work, AI scopes it, pulls from price book, builds estimate
- **Photo/video-based estimating** — customer sends photo of their unit/problem, vision model identifies equipment, condition, scope needed
- **Price book integration** — pulls flat-rate prices from ServiceTitan/Jobber price book, or uses your configured rates
- **Good/Better/Best options** — auto-generates tiered options: repair vs mid-range replacement vs premium replacement
- **T&M estimates** — for jobs that can't be flat-rated: estimated hours x rate + estimated materials + markup
- **Material takeoff** — from plans/scope, generates material list with quantities and current pricing from suppliers
- **Labor calculation** — hours by trade/skill level, loaded rates (wage + burden + WC + benefits + overhead)
- **Subcontractor pricing** — includes sub quotes in your estimate, with your markup
- **Permit & fee inclusion** — adds permit costs, inspection fees, disposal fees based on jurisdiction and work type
- **Equipment rental** — if the job needs a trencher, lift, pump, includes rental cost
- **Travel/mobilization** — for jobs outside your normal service area, adds travel charge
- **Overhead & profit** — applies your O&P rates (standard in commercial/insurance work)
- **Contingency** — adds a contingency percentage for unknowns (standard on larger jobs)
- **Scope of work narrative** — AI writes a clear, professional description of what's included and what's NOT included (exclusions are critical)

### B. Trade-Specific Technical Scoping

The estimate isn't just pricing. It's engineering. The agent flags when technical scoping is required vs when you can price from a template.

- **HVAC: load calculations** — Manual J/S/D to size the unit correctly. Wrong size means callbacks. Agent flags: "This is a 2,400 sq ft home with poor insulation. Don't just match the old unit, run the numbers."
- **Electrical: panel capacity** — "Customer wants a car charger but the panel is maxed. This estimate includes a panel upgrade."
- **Plumbing: fixture count** — drives permit type and inspection requirements. Agent counts fixtures from scope and flags permit implications
- **General: structural implications** — "Removing this wall may require structural support. Include engineering allowance?"
- **Equipment compatibility** — "The existing ductwork won't support the higher-efficiency unit without modification. Include duct modification in scope."
- **Code requirements** — jurisdiction-specific code that affects scope and cost. "NYC requires backflow preventer on this installation, add $800"

### C. Multi-Format Proposals

Different customers need different formats. A homeowner gets a simple proposal. A GC gets a formal bid. An insurance company gets Xactimate.

- **Residential proposal** — clean, simple: here's the problem, here's what we'll do, here's what it costs, here are your options
- **Commercial bid** — formal: scope, schedule, inclusions/exclusions, terms, insurance info, references
- **GC bid/subcontractor proposal** — per plan spec, broken down by CSI division, matching their scope breakdown
- **Insurance/Xactimate estimate** — line items matching Xactimate pricing database for insurance claims
- **Government/public bid** — sealed bid format with all required certifications, bonds, compliance docs attached
- **Unit price bids** — "We'll do X per linear foot / per fixture / per ton" — common in commercial
- **Design-build proposals** — includes design phase, engineering, construction — phased pricing
- **Maintenance agreement proposals** — recurring service: here's what's covered, here's the annual/monthly cost
- **Branded PDF** — your logo, professional layout, terms and conditions on every proposal

### D. Financing & Upsell Presentation

At the estimate stage, financing is a sales tool and every job is a cross-sell opportunity.

- **Financing options on proposal** — "$9,500 today or $198/month for 48 months" presented alongside the price, not as a separate conversation
- **Cash/check discount** — "Save 5% if you pay today" shown as an option
- **Upsell suggestions** — "While we're replacing the water heater, the expansion tank is 8 years old. Add replacement for $350?"
- **Service agreement attach** — "Add our Priority Club membership for $19/month. Includes annual tune-up + 15% off future repairs."
- **Accessory/upgrade options** — smart thermostat with HVAC install, water filtration with plumbing work, surge protector with panel upgrade
- **Rebate/incentive callout** — "This heat pump qualifies for a 30% federal tax credit. Your net cost after credits: $6,650." (presented as info, not managed by the agent)

### E. Pricing Intelligence

The agent doesn't just calculate. It thinks about pricing strategy.

- **Historical win rate by price point** — "You've sent 40 water heater estimates. You win 60% under $4,500 and 25% over $5,000"
- **Market rate comparison** — "Your average AC install is $8,200. Market average in your zip code is $9,400. You're 13% under."
- **Customer-specific pricing** — repeat customer gets loyalty pricing, new customer gets standard, commercial gets different margin
- **Seasonal pricing** — "AC installs are premium in July. Consider 10% seasonal markup"
- **Competitor awareness** — "This customer got another quote for $7,800" (if they tell you). Agent adjusts strategy
- **Margin floor enforcement** — "This estimate is at 22% margin. Your minimum is 30%. Adjust or override?"
- **Volume/relationship discounts** — property manager sends you 50 jobs/year, auto-applies negotiated rate
- **Price escalation tracking** — "Copper is up 18% since you priced this job 60 days ago. Update the material costs?"
- **Demand-based pricing** — you're booked 3 weeks out? You have pricing power. Schedule is empty? Maybe be more competitive
- **Rush/expedite pricing** — "Customer needs this by Friday. That's a rush job." Agent adds expedite fee and checks capacity with field-ops before committing to the timeline

### F. Plan & Spec Takeoff

For commercial/project work where you're bidding from drawings.

- **Plan review** — upload plans (PDF), AI identifies scope relevant to your trade
- **Quantity takeoff** — counts fixtures, measures pipe runs, identifies equipment from plan specs
- **Spec compliance** — "Plans call for Type L copper. Your estimate has Type M. Fix?"
- **Addendum tracking** — plans change during bidding, agent tracks addenda and flags what changed in your scope
- **RFI generation** — "Plans don't specify the water heater brand. Generate RFI to architect?"
- **Scope gap identification** — "Plans show gas piping but it's not in the mechanical spec section. Is this in your scope or the plumber's?"
- **Bid day management** — deadline tracking, last-minute sub quotes coming in, final number assembly

### G. Estimate Delivery & Follow-Up

Getting it in front of the customer fast and following up until they decide.

- **Instant send** — estimate generated and sent within minutes of the call/request, not days
- **Delivery method per customer** — email, text with link, print for in-person, portal upload for GCs
- **E-signature** — customer can approve/sign digitally right from the estimate
- **Deposit collection** — "Approve and pay 30% deposit to schedule" with integrated payment link
- **Follow-up sequence** — auto follow-up if no response: Day 1, Day 3, Day 7, Day 14, Day 30
- **Follow-up intelligence** — "Customer opened the estimate 4 times but hasn't approved. They're interested but hesitating. Call them."
- **Objection handling** — customer says "too expensive", agent suggests: present financing options, adjust scope, show value comparison
- **Expiration** — estimates expire after X days (configurable), prices may not hold
- **Revision tracking** — customer wants changes, new version created, track what changed, don't lose the original
- **Decline reason tracking** — when they say no: too expensive? went with someone else? decided not to do the work? project delayed? Feeds back into pricing intelligence
- **Re-estimate / re-pricing** — customer comes back 6 months later, wants to do the work now. Material prices changed, labor rates changed, maybe code changed. Agent re-prices, doesn't just resend the stale estimate

### H. Conversion & Pipeline Management

The estimate isn't just a document. It's a sales pipeline.

- **Pipeline view** — all outstanding estimates: sent, opened, follow-up needed, expiring soon, won, lost
- **Conversion rate tracking** — overall, by estimate type, by tech/salesperson, by lead source
- **Revenue forecast** — "You have $340K in outstanding estimates. At your 45% close rate, expect ~$153K"
- **Aging estimates** — "23 estimates older than 30 days. Review: still active or dead?"
- **Win/loss analysis** — "You win 70% of referrals, 30% of Google leads, 15% of home warranty leads. Where should you spend marketing dollars?"
- **Close rate by option** — "Customers pick 'Better' 55% of the time, 'Best' 20%, 'Good' 25%"
- **Average ticket tracking** — trending up or down? By category?
- **Speed-to-estimate** — "Your average time from request to estimate sent is 2.4 days. Top performers do same-day."
- **Competitive bid tracking** — on commercial work, you bid against the same companies repeatedly. Track win/loss by competitor. "You're 2-for-8 against XYZ Plumbing. They're consistently 10% lower. Adjust strategy or accept the loss rate."

### I. Estimate-to-Contract Conversion

For bigger jobs, the approved estimate becomes a contract. Not a separate manual step.

- **Auto-generate contract from approved estimate** — scope, price, payment schedule, start/completion dates, terms and conditions
- **Payment schedule** — deposit, progress payments, final payment, retainage (all from the estimate terms)
- **Legal terms inclusion** — your standard terms: liability limitations, dispute resolution, warranty, change order process
- **Liquidated damages** — if applicable (commercial/GC work), include LD terms
- **Insurance requirements** — what the customer/GC requires, confirmed before signing
- **Permit responsibility** — who pulls permits, who pays for them, clearly stated
- **Start date contingencies** — "Contract start date contingent on permit approval and deposit receipt"
- **Digital signature** — customer signs contract digitally, both parties get executed copy
- **Contract amendment tracking** — if terms change before work starts, track amendments

### J. Change Orders

The constant source of lost revenue and disputes. The agent manages change orders from identification through billing.

- **Scope change identification** — concealed conditions found, customer adds work, architect changes plans, GC directs changes
- **Change order pricing** — T&M vs fixed price vs negotiated, based on contract terms for allowable change order markup
- **Documentation** — what changed, why, who requested it, photos of concealed conditions, reference to original scope
- **Written approval BEFORE work** — the cardinal rule. Agent generates CO, sends for approval, blocks work on unapproved changes. Most contractors do the work first and fight about money later. This fixes that.
- **Schedule impact** — does this change push the completion date? Agent calculates and documents
- **Impact on other trades** — your change affects the electrician's scope? Flag it
- **Cumulative tracking** — "Original contract $80K, change orders total $34K, that's 42% growth. Is this project still profitable?"
- **GC-initiated vs owner-initiated vs field-discovered** — different approval paths, different documentation
- **Disputed change orders** — you say it's extra, GC says it's in your scope. Agent helps build the case with plan references, spec sections, and scope comparison
- **Change order markup** — many contracts specify allowable markup on changes (often different from base contract). Agent applies the correct rate
- **Back charge defense** — GC back charges you, was it actually your fault? Agent cross-references with scope, schedule, and documentation to build defense
- **Change order log** — running log required for project closeout documentation

### K. Scope & Risk Management

Protecting yourself from underpricing and scope disputes.

- **Exclusions list** — AI auto-generates standard exclusions based on work type ("Does NOT include: asbestos abatement, structural repair, painting, drywall patching")
- **Assumptions documentation** — "Estimate assumes standard installation. If concealed conditions are found, additional charges may apply"
- **Allowances** — "Fixture allowance: $2,500. Customer selects specific fixtures, actual cost may vary"
- **Site visit flag** — "This job type has high variance. Recommend site visit before pricing" (AI knows which job types need eyes on them)
- **Change order protocol** — terms state how changes are handled and priced
- **Scope creep detection** — job in progress, hours/materials exceeding estimate. Alert before it's too late to get a change order
- **Warranty terms** — what's warranted, for how long, what voids it. Included in every estimate

### L. Pre-Construction & Job Setup

The estimate is the seed for everything that follows.

- **Job creation on approval** — estimate approved, auto-creates job in field service tool with all scope details
- **Material pre-order** — estimate approved, auto-generates PO for materials with long lead times
- **Permit identification** — based on scope, flags what permits are needed. Chains to compliance
- **Scheduling** — estimate approved, chains to field-ops: "Schedule this job, here's the scope and estimated duration"
- **Deposit processing** — deposit received, chains to finance
- **Sub notification** — if subs are in the estimate, notify them: "We got the job, your scope is X, start date TBD"
- **Customer communication** — "Thank you for choosing us. Here's what happens next: permit filing, scheduling, material ordering"

### M. Template & Knowledge Management

Building institutional knowledge so estimates get better over time.

- **Estimate templates** — by job type: "Water heater install", "Bathroom rough-in", "Boiler replacement". Starting point with standard scope/pricing
- **Actual vs estimated tracking** — after job completes, compare: did the job actually cost what you estimated? Where were you off?
- **Template refinement** — "Your water heater estimates average 12% under actual cost. Primary gap: additional fittings and disposal fee. Suggest updating template."
- **Regional pricing** — same job type costs differently in Manhattan vs Brooklyn vs Long Island
- **New tech training** — new estimator/tech uses templates + AI guidance to estimate like your best person
- **Scope library** — reusable scope narratives for common work types
- **Photo library** — before/after photos from past jobs to include in proposals

---

## Agent Chains

| Event | Chains To | What Happens |
|-------|-----------|-------------|
| Estimate approved | **Field-ops** | Schedule the job |
| Estimate approved | **Inventory** | Pre-order materials, check stock |
| Estimate approved | **Finance** | Log deposit, expected revenue |
| Estimate approved | **Compliance** | Identify permit requirements |
| Estimate approved + sub work | **Invoice** | Sub POs generated |
| Estimate-to-contract signed | **Compliance** | Contract compliance obligations tracked |
| Change order approved | **Invoice** | Additional billing |
| Change order affects schedule | **Field-ops** | Adjust job duration/dates |
| Change order affects materials | **Inventory** | Additional material order |
| Estimate declined — too expensive | **Customer** | Retention outreach, alternative options |
| Estimate declined — went elsewhere | **Insights** | Competitive analysis data point |
| Estimate stale > 30 days | **Customer** | "Still interested?" outreach |
| Estimate margin below floor | **Insights** | Pricing review flag |
| Job complete — actual vs estimated | **Insights** | Template refinement data |
| Scope creep detected during job | **Invoice** | Change order, additional billing |
| Material prices changed significantly | **Inventory** | Update pending estimates with new costs |
| GC bid due date approaching | **Compliance** | Bid bond, certifications ready? |
| Insurance estimate | **Compliance** | Documentation requirements |
| Rush job requested | **Field-ops** | Capacity check before committing |

---

## Autonomy Rules

| Action | Tier | Why |
|--------|------|-----|
| Generate estimate from template + price book | AUTO | Deterministic |
| Calculate materials, labor, tax, markup | AUTO | Math |
| Send follow-up reminders | AUTO | Standard sequence |
| Track estimate open/view status | AUTO | Passive |
| Create job on estimate approval | AUTO | Standard workflow |
| Generate change order documentation | AUTO | Documentation |
| Re-price stale estimate with current costs | AUTO | Math update |
| Send estimate to residential customer | REVIEW | Pricing is money |
| Send estimate to commercial/GC | REVIEW | Higher stakes, complex scope |
| Apply non-standard discount | REVIEW | Revenue impact |
| Estimate significantly above/below market | REVIEW | May lose job or leave money |
| Bid on public/government work | REVIEW | Bond + compliance implications |
| Estimate over $X threshold | REVIEW | High dollar, high risk |
| Change order over $X or >20% of contract | REVIEW | Significant scope change |
| Generate contract from estimate | REVIEW | Legal document |
| Override margin floor | ESCALATE | Below minimum profitability |
| Commit to scope on plan work without site visit | ESCALATE | High variance risk |
| Accept GC back-charge related to estimate scope | ESCALATE | Financial + legal |
| Disputed change order response | ESCALATE | Legal/relationship risk |
