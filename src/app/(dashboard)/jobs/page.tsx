'use client';

import { Plus } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';

interface Job {
  id: string;
  title: string;
  customer: string;
  type: string;
  status: string;
  assignee: string;
  scheduledDate: string;
  amount: string;
  [key: string]: unknown;
}

const statusBadgeVariant = (status: string) => {
  switch (status) {
    case 'Completed':
      return 'success' as const;
    case 'In Progress':
      return 'accent' as const;
    case 'Scheduled':
      return 'info' as const;
    default:
      return 'default' as const;
  }
};

const columns: Column<Job>[] = [
  { key: 'id', header: 'Job #', className: 'w-24' },
  { key: 'title', header: 'Title' },
  { key: 'customer', header: 'Customer' },
  { key: 'type', header: 'Type' },
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <Badge variant={statusBadgeVariant(row.status)}>
        {row.status}
      </Badge>
    ),
  },
  { key: 'assignee', header: 'Assignee' },
  { key: 'scheduledDate', header: 'Scheduled' },
  { key: 'amount', header: 'Amount', className: 'text-right' },
];

const jobs: Job[] = [
  { id: 'JOB-001', title: 'HVAC Installation', customer: 'Apex Properties', type: 'HVAC', status: 'In Progress', assignee: 'Mike Torres', scheduledDate: '2025-01-15', amount: '$4,500' },
  { id: 'JOB-002', title: 'Emergency Pipe Repair', customer: 'Metro Residential', type: 'Plumbing', status: 'Scheduled', assignee: 'Sarah Chen', scheduledDate: '2025-01-16', amount: '$1,200' },
  { id: 'JOB-003', title: 'Panel Upgrade 200A', customer: 'Summit Office Park', type: 'Electrical', status: 'Completed', assignee: 'James Wright', scheduledDate: '2025-01-12', amount: '$3,800' },
  { id: 'JOB-004', title: 'AC Maintenance', customer: 'Harbor View Hotels', type: 'HVAC', status: 'In Progress', assignee: 'Mike Torres', scheduledDate: '2025-01-15', amount: '$850' },
  { id: 'JOB-005', title: 'Water Heater Replace', customer: 'Elm Street Homes', type: 'Plumbing', status: 'Scheduled', assignee: 'Sarah Chen', scheduledDate: '2025-01-17', amount: '$2,100' },
  { id: 'JOB-006', title: 'Outlet Installation', customer: 'Tech Hub Co-work', type: 'Electrical', status: 'Draft', assignee: 'Unassigned', scheduledDate: '2025-01-18', amount: '$600' },
  { id: 'JOB-007', title: 'Duct Cleaning', customer: 'Greenfield School', type: 'HVAC', status: 'Completed', assignee: 'Mike Torres', scheduledDate: '2025-01-10', amount: '$1,800' },
  { id: 'JOB-008', title: 'Sewer Line Inspection', customer: 'Pine Valley HOA', type: 'Plumbing', status: 'In Progress', assignee: 'Carlos Ruiz', scheduledDate: '2025-01-14', amount: '$950' },
];

export default function JobsPage() {
  return (
    <>
      <Header title="Jobs" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary">
              Manage and track all service jobs
            </p>
          </div>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Job
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={jobs}
          searchPlaceholder="Search jobs..."
          searchKey="title"
        />
      </div>
    </>
  );
}
