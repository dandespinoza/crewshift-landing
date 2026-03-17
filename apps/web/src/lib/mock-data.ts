// Mock data for Espinoza Plumbing Co. dashboard

// ---------------------------------------------------------------------------
// 1. Stat Cards
// ---------------------------------------------------------------------------

export type StatCard = {
  title: string;
  value: string | number;
  changeLabel: string;
  changeDirection: "up" | "down" | "neutral";
  changePercent?: string;
  subLabel: string;
};

export const statCards: StatCard[] = [
  {
    title: "Open Quotes",
    value: 14,
    changeLabel: "+22%",
    changeDirection: "up",
    changePercent: "+22%",
    subLabel: "$38,600 total value",
  },
  {
    title: "Active Jobs",
    value: 9,
    changeLabel: "+8%",
    changeDirection: "up",
    changePercent: "+8%",
    subLabel: "4 completing today",
  },
  {
    title: "Pending Requests",
    value: 6,
    changeLabel: "3 new today",
    changeDirection: "neutral",
    subLabel: "Avg 1.8hr response time",
  },
  {
    title: "Revenue MTD",
    value: "$118,400",
    changeLabel: "+14%",
    changeDirection: "up",
    changePercent: "+14%",
    subLabel: "$19,200 AR outstanding",
  },
] as const;

// ---------------------------------------------------------------------------
// 2. Revenue Chart Data (last 30 days)
// ---------------------------------------------------------------------------

export type RevenueDataPoint = {
  date: string;
  revenue: number;
};

export const revenueChartData: RevenueDataPoint[] = [
  { date: "Feb 3", revenue: 3400 },
  { date: "Feb 5", revenue: 5200 },
  { date: "Feb 7", revenue: 2800 },
  { date: "Feb 10", revenue: 6100 },
  { date: "Feb 12", revenue: 4500 },
  { date: "Feb 14", revenue: 7300 },
  { date: "Feb 17", revenue: 3800 },
  { date: "Feb 19", revenue: 5600 },
  { date: "Feb 21", revenue: 7900 },
  { date: "Feb 24", revenue: 4200 },
  { date: "Feb 26", revenue: 6400 },
  { date: "Feb 28", revenue: 7100 },
  { date: "Mar 1", revenue: 5200 },
  { date: "Mar 3", revenue: 6500 },
  { date: "Mar 5", revenue: 4800 },
];

// ---------------------------------------------------------------------------
// 3. Quotes Pipeline
// ---------------------------------------------------------------------------

export type PipelineStage = {
  name: string;
  count: number;
  color: string;
};

export type RecentQuote = {
  customer: string;
  service: string;
  amount: number;
  status: "Draft" | "Sent" | "Viewed" | "Accepted";
  date: string;
};

export type QuotesPipeline = {
  stages: PipelineStage[];
  recentQuotes: RecentQuote[];
};

export const quotesPipeline: QuotesPipeline = {
  stages: [
    { name: "Draft", count: 4, color: "#94a3b8" },
    { name: "Sent", count: 5, color: "#60a5fa" },
    { name: "Viewed", count: 3, color: "#f59e0b" },
    { name: "Accepted", count: 2, color: "#22c55e" },
  ],
  recentQuotes: [
    {
      customer: "Maria Santos",
      service: "Whole-home repipe",
      amount: 12800,
      status: "Viewed",
      date: "Mar 4",
    },
    {
      customer: "Tom Henderson",
      service: "Bathroom remodel rough-in",
      amount: 6400,
      status: "Sent",
      date: "Mar 3",
    },
    {
      customer: "Jennifer Walsh",
      service: "Commercial drain cleaning (restaurant)",
      amount: 2200,
      status: "Draft",
      date: "Mar 5",
    },
    {
      customer: "Robert Kim",
      service: "Tankless water heater install",
      amount: 3850,
      status: "Sent",
      date: "Mar 2",
    },
    {
      customer: "Sarah Mitchell",
      service: "Sewer line replacement (trenchless)",
      amount: 8900,
      status: "Accepted",
      date: "Mar 1",
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Jobs Pipeline
// ---------------------------------------------------------------------------

export type TodaysJob = {
  job: string;
  customer: string;
  tech: string;
  time: string;
  status: "In Progress" | "Scheduled" | "Completed";
};

export type JobsPipeline = {
  stages: PipelineStage[];
  todaysJobs: TodaysJob[];
};

export const jobsPipeline: JobsPipeline = {
  stages: [
    { name: "Scheduled", count: 6, color: "#60a5fa" },
    { name: "In Progress", count: 3, color: "#f59e0b" },
    { name: "Completed", count: 14, color: "#22c55e" },
    { name: "Invoiced", count: 9, color: "#a78bfa" },
  ],
  todaysJobs: [
    {
      job: "Kitchen drain clog",
      customer: "Lisa Park, 4421 E Camelback Rd",
      tech: "Mike R.",
      time: "8:00 AM",
      status: "In Progress",
    },
    {
      job: "Tankless water heater install",
      customer: "James Cooper, 1892 W Glendale Ave",
      tech: "Tony M.",
      time: "9:00 AM",
      status: "In Progress",
    },
    {
      job: "Backflow preventer test & cert",
      customer: "Phoenix Office Park, 2200 N Central",
      tech: "Carlos S.",
      time: "10:30 AM",
      status: "Scheduled",
    },
    {
      job: "Slab leak detection",
      customer: "David Chen, 7734 N Scottsdale Rd",
      tech: "Alex P.",
      time: "12:00 PM",
      status: "Scheduled",
    },
    {
      job: "Emergency burst pipe in wall",
      customer: "Karen White, 3301 S Mill Ave",
      tech: "Mike R.",
      time: "2:30 PM",
      status: "Scheduled",
    },
    {
      job: "Garbage disposal replacement",
      customer: "Frank Nguyen, 5510 E Thomas Rd",
      tech: "Jesse L.",
      time: "3:00 PM",
      status: "In Progress",
    },
  ],
};

// ---------------------------------------------------------------------------
// 5. Customer Requests
// ---------------------------------------------------------------------------

export type CustomerRequest = {
  customer: string;
  request: string;
  priority: "High" | "Medium" | "Low";
  channel: "Phone" | "Website form" | "Email" | "SMS";
  time: string;
};

export const customerRequests: CustomerRequest[] = [
  {
    customer: "Lisa Park",
    request: "Drain backed up again since last week's visit",
    priority: "High",
    channel: "Phone",
    time: "1 hour ago",
  },
  {
    customer: "New Lead — Mark Torres",
    request: "Need quote for whole-house repipe — have polybutylene",
    priority: "Medium",
    channel: "Website form",
    time: "3 hours ago",
  },
  {
    customer: "Jennifer Walsh",
    request: "Can the restaurant drain cleaning happen before 6 AM?",
    priority: "Low",
    channel: "Email",
    time: "Yesterday",
  },
  {
    customer: "Robert Kim",
    request: "What's the warranty on the Rinnai tankless unit?",
    priority: "Low",
    channel: "SMS",
    time: "Yesterday",
  },
  {
    customer: "Tom Henderson",
    request: "Any update on the bathroom remodel quote?",
    priority: "Medium",
    channel: "Phone",
    time: "2 days ago",
  },
  {
    customer: "New Lead — Angela Rivera",
    request: "Sewer smell in backyard — need inspection ASAP",
    priority: "High",
    channel: "Phone",
    time: "30 min ago",
  },
];

// ---------------------------------------------------------------------------
// 6. Finance Overview
// ---------------------------------------------------------------------------

export type OverdueInvoice = {
  invoiceNumber: string;
  customer: string;
  service: string;
  amount: number;
  daysOverdue: number;
};

export type FinanceOverview = {
  revenueMTD: number;
  expensesMTD: number;
  grossProfit: number;
  grossMarginPct: number;
  arOutstanding: number;
  arOverdue: number;
  arOverdueCount: number;
  apDueThisWeek: number;
  cashInBank: number;
  overdueInvoices: OverdueInvoice[];
};

export const financeOverview: FinanceOverview = {
  revenueMTD: 118400,
  expensesMTD: 71800,
  grossProfit: 46600,
  grossMarginPct: 39,
  arOutstanding: 19200,
  arOverdue: 6800,
  arOverdueCount: 3,
  apDueThisWeek: 8900,
  cashInBank: 54200,
  overdueInvoices: [
    {
      invoiceNumber: "INV-1847",
      customer: "Pacific Ridge HOA",
      service: "Common area backflow testing",
      amount: 3400,
      daysOverdue: 45,
    },
    {
      invoiceNumber: "INV-1862",
      customer: "Greg Thompson",
      service: "Slab leak repair",
      amount: 1850,
      daysOverdue: 38,
    },
    {
      invoiceNumber: "INV-1871",
      customer: "Mesa School District",
      service: "Restroom fixture replacement",
      amount: 1550,
      daysOverdue: 32,
    },
  ],
};

// ---------------------------------------------------------------------------
// 7. AI Suggestions
// ---------------------------------------------------------------------------

export type AiSuggestion = {
  suggestion: string;
  type: string;
  action: string;
};

export const aiSuggestions: AiSuggestion[] = [
  {
    suggestion:
      "3 quotes expiring this week — Maria Santos ($12,800 repipe), Robert Kim ($3,850 tankless), and Mark Torres (pending). Want me to send follow-ups?",
    type: "Revenue recovery",
    action: "Send follow-ups",
  },
  {
    suggestion:
      "Invoice #1847 is 45 days overdue ($3,400 — Pacific Ridge HOA). Collections Agent recommends escalating to phone call.",
    type: "Collections",
    action: "Start collection",
  },
  {
    suggestion:
      "Mike R. has a drain callback at 8 AM and an emergency burst pipe at 2:30 PM. Consider sending Jesse L. to the emergency so Mike can finish the callback properly.",
    type: "Scheduling",
    action: "Reassign job",
  },
  {
    suggestion:
      "Tankless water heater installs are your highest-margin service (52% gross). You've done 6 this month — consider running a 'tankless upgrade' promo on your website.",
    type: "Growth insight",
    action: "View analytics",
  },
];

// ---------------------------------------------------------------------------
// 8. Activity Feed
// ---------------------------------------------------------------------------

export type ActivityFeedItem = {
  time: string;
  agent: string;
  event: string;
  status: "success" | "completed" | "pending" | "warning";
};

export const activityFeed: ActivityFeedItem[] = [
  {
    time: "5 min ago",
    agent: "Invoice Agent",
    event: "Generated invoice #1923 for Lisa Park — drain cleaning ($280)",
    status: "success",
  },
  {
    time: "18 min ago",
    agent: "Collections Agent",
    event: "Sent payment reminder to Greg Thompson — INV-1862 ($1,850)",
    status: "success",
  },
  {
    time: "42 min ago",
    agent: "Dan (manual)",
    event: "Approved quote for Maria Santos — whole-home repipe ($12,800)",
    status: "completed",
  },
  {
    time: "1 hour ago",
    agent: "Estimate Agent",
    event: "Created draft quote for Mark Torres — repipe ($9,400)",
    status: "pending",
  },
  {
    time: "2 hours ago",
    agent: "Field Ops Agent",
    event: "Rescheduled David Chen slab leak from 10 AM → 12 PM (tech conflict)",
    status: "success",
  },
  {
    time: "3 hours ago",
    agent: "Invoice Agent",
    event: "Auto-sent invoice #1922 to James Cooper — water heater install ($3,850)",
    status: "success",
  },
  {
    time: "Yesterday",
    agent: "Collections Agent",
    event: "Escalated INV-1847 (Pacific Ridge HOA, $3,400) — 45 days overdue",
    status: "warning",
  },
];

// ---------------------------------------------------------------------------
// 9. Agent Performance
// ---------------------------------------------------------------------------

export type AgentStatus = "active" | "idle" | "error";

export type InvoiceAgentPerformance = {
  status: AgentStatus;
  actionsToday: number;
  accuracy: number;
  totalProcessed: number;
  avgProcessingTime: string;
  autoApprovalRate: number;
  pendingReview: number;
};

export type EstimateAgentPerformance = {
  status: AgentStatus;
  actionsToday: number;
  accuracy: number;
  totalProcessed: number;
  avgEstimateTime: string;
  acceptanceRate: number;
  draftsInProgress: number;
};

export type CollectionsAgentPerformance = {
  status: AgentStatus;
  actionsToday: number;
  recoveryRate: number;
  totalContacted: number;
  amountRecovered: number;
  avgDaysToResolve: number;
  escalationsPending: number;
};

export type FieldOpsAgentPerformance = {
  status: AgentStatus;
  actionsToday: number;
  scheduleAdherence: number;
  reschedules: number;
  techUtilizationRate: number;
  conflictsResolved: number;
  openConflicts: number;
};

export type AgentPerformance = {
  invoice: InvoiceAgentPerformance;
  estimate: EstimateAgentPerformance;
  collections: CollectionsAgentPerformance;
  fieldOps: FieldOpsAgentPerformance;
};

export const agentPerformance: AgentPerformance = {
  invoice: {
    status: "active",
    actionsToday: 8,
    accuracy: 98,
    totalProcessed: 142,
    avgProcessingTime: "1.2 min",
    autoApprovalRate: 91,
    pendingReview: 2,
  },
  estimate: {
    status: "active",
    actionsToday: 3,
    accuracy: 94,
    totalProcessed: 67,
    avgEstimateTime: "4.5 min",
    acceptanceRate: 72,
    draftsInProgress: 4,
  },
  collections: {
    status: "active",
    actionsToday: 5,
    recoveryRate: 68,
    totalContacted: 31,
    amountRecovered: 14200,
    avgDaysToResolve: 12,
    escalationsPending: 3,
  },
  fieldOps: {
    status: "active",
    actionsToday: 4,
    scheduleAdherence: 87,
    reschedules: 2,
    techUtilizationRate: 83,
    conflictsResolved: 6,
    openConflicts: 1,
  },
};

// ---------------------------------------------------------------------------
// 10. Analytics Data
// ---------------------------------------------------------------------------

export type MonthlyRevenueTrend = {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
};

export type ServiceRevenue = {
  service: string;
  revenue: number;
  jobCount: number;
  avgTicket: number;
  marginPct: number;
};

export type TechProductivity = {
  tech: string;
  jobsCompleted: number;
  revenueGenerated: number;
  avgJobDuration: string;
  customerRating: number;
  callbackRate: number;
};

export type CustomerAcquisition = {
  channel: string;
  leads: number;
  converted: number;
  conversionRate: number;
  avgJobValue: number;
};

export type QuoteConversionFunnelStage = {
  stage: string;
  count: number;
  dropOffPct: number;
};

export type SeasonalDemand = {
  month: string;
  demandIndex: number;
  topService: string;
};

export type WeeklyCashFlow = {
  week: string;
  inflow: number;
  outflow: number;
  netCash: number;
};

export type AnalyticsData = {
  revenueTrend6Months: MonthlyRevenueTrend[];
  topServicesByRevenue: ServiceRevenue[];
  techProductivity: TechProductivity[];
  customerAcquisition: CustomerAcquisition[];
  quoteConversionFunnel: QuoteConversionFunnelStage[];
  seasonalDemand: SeasonalDemand[];
  cashFlow4Weeks: WeeklyCashFlow[];
};

export const analyticsData: AnalyticsData = {
  revenueTrend6Months: [
    { month: "Oct", revenue: 89400, expenses: 56200, profit: 33200 },
    { month: "Nov", revenue: 94100, expenses: 58800, profit: 35300 },
    { month: "Dec", revenue: 107300, expenses: 64900, profit: 42400 },
    { month: "Jan", revenue: 98600, expenses: 61400, profit: 37200 },
    { month: "Feb", revenue: 112800, expenses: 68500, profit: 44300 },
    { month: "Mar", revenue: 118400, expenses: 71800, profit: 46600 },
  ],

  topServicesByRevenue: [
    {
      service: "Whole-home repipe",
      revenue: 38400,
      jobCount: 3,
      avgTicket: 12800,
      marginPct: 44,
    },
    {
      service: "Sewer line replacement",
      revenue: 26700,
      jobCount: 3,
      avgTicket: 8900,
      marginPct: 41,
    },
    {
      service: "Tankless water heater install",
      revenue: 23100,
      jobCount: 6,
      avgTicket: 3850,
      marginPct: 52,
    },
    {
      service: "Slab leak repair",
      revenue: 14800,
      jobCount: 5,
      avgTicket: 2960,
      marginPct: 38,
    },
    {
      service: "Bathroom remodel rough-in",
      revenue: 12800,
      jobCount: 2,
      avgTicket: 6400,
      marginPct: 36,
    },
    {
      service: "Commercial drain cleaning",
      revenue: 8800,
      jobCount: 4,
      avgTicket: 2200,
      marginPct: 61,
    },
    {
      service: "Backflow testing & cert",
      revenue: 6800,
      jobCount: 8,
      avgTicket: 850,
      marginPct: 67,
    },
    {
      service: "Emergency service calls",
      revenue: 5200,
      jobCount: 6,
      avgTicket: 867,
      marginPct: 55,
    },
  ],

  techProductivity: [
    {
      tech: "Mike R.",
      jobsCompleted: 22,
      revenueGenerated: 31400,
      avgJobDuration: "2.4 hrs",
      customerRating: 4.8,
      callbackRate: 4,
    },
    {
      tech: "Tony M.",
      jobsCompleted: 18,
      revenueGenerated: 28600,
      avgJobDuration: "2.9 hrs",
      customerRating: 4.9,
      callbackRate: 2,
    },
    {
      tech: "Carlos S.",
      jobsCompleted: 24,
      revenueGenerated: 20400,
      avgJobDuration: "1.8 hrs",
      customerRating: 4.7,
      callbackRate: 3,
    },
    {
      tech: "Alex P.",
      jobsCompleted: 16,
      revenueGenerated: 22800,
      avgJobDuration: "3.1 hrs",
      customerRating: 4.6,
      callbackRate: 6,
    },
    {
      tech: "Jesse L.",
      jobsCompleted: 20,
      revenueGenerated: 15200,
      avgJobDuration: "1.6 hrs",
      customerRating: 4.5,
      callbackRate: 5,
    },
  ],

  customerAcquisition: [
    {
      channel: "Referral",
      leads: 18,
      converted: 14,
      conversionRate: 78,
      avgJobValue: 4200,
    },
    {
      channel: "Google / SEO",
      leads: 31,
      converted: 19,
      conversionRate: 61,
      avgJobValue: 2800,
    },
    {
      channel: "Website form",
      leads: 12,
      converted: 6,
      conversionRate: 50,
      avgJobValue: 3100,
    },
    {
      channel: "Repeat customer",
      leads: 22,
      converted: 21,
      conversionRate: 95,
      avgJobValue: 1900,
    },
    {
      channel: "Yelp / HomeAdvisor",
      leads: 9,
      converted: 3,
      conversionRate: 33,
      avgJobValue: 1400,
    },
    {
      channel: "Door hanger / Direct mail",
      leads: 6,
      converted: 2,
      conversionRate: 33,
      avgJobValue: 950,
    },
  ],

  quoteConversionFunnel: [
    { stage: "Quote created", count: 28, dropOffPct: 0 },
    { stage: "Sent to customer", count: 22, dropOffPct: 21 },
    { stage: "Viewed by customer", count: 17, dropOffPct: 23 },
    { stage: "Follow-up sent", count: 13, dropOffPct: 24 },
    { stage: "Accepted", count: 10, dropOffPct: 23 },
  ],

  seasonalDemand: [
    { month: "Jan", demandIndex: 72, topService: "Frozen pipe emergencies" },
    { month: "Feb", demandIndex: 78, topService: "Whole-home repipe" },
    { month: "Mar", demandIndex: 85, topService: "Sewer line replacement" },
    { month: "Apr", demandIndex: 91, topService: "Irrigation system startup" },
    { month: "May", demandIndex: 96, topService: "Tankless water heater" },
    { month: "Jun", demandIndex: 100, topService: "A/C condensate drain" },
    { month: "Jul", demandIndex: 98, topService: "Emergency drain cleaning" },
    { month: "Aug", demandIndex: 95, topService: "Water softener install" },
    { month: "Sep", demandIndex: 88, topService: "Backflow certification" },
    { month: "Oct", demandIndex: 82, topService: "Water heater replacement" },
    { month: "Nov", demandIndex: 76, topService: "Gas line inspection" },
    { month: "Dec", demandIndex: 68, topService: "Holiday drain service" },
  ],

  cashFlow4Weeks: [
    { week: "Feb 10–16", inflow: 28400, outflow: 19200, netCash: 9200 },
    { week: "Feb 17–23", inflow: 31600, outflow: 22800, netCash: 8800 },
    { week: "Feb 24–Mar 2", inflow: 34200, outflow: 18600, netCash: 15600 },
    { week: "Mar 3–5 (MTD)", inflow: 24200, outflow: 11200, netCash: 13000 },
  ],
};
