'use client';

import { Plus } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';

interface Invoice {
  id: string;
  customer: string;
  jobTitle: string;
  amount: string;
  status: string;
  issuedDate: string;
  dueDate: string;
  [key: string]: unknown;
}

const statusBadgeVariant = (status: string) => {
  switch (status) {
    case 'Paid':
      return 'success' as const;
    case 'Sent':
      return 'accent' as const;
    case 'Overdue':
      return 'danger' as const;
    default:
      return 'default' as const;
  }
};

const columns: Column<Invoice>[] = [
  { key: 'id', header: 'Invoice #', className: 'w-28' },
  { key: 'customer', header: 'Customer' },
  { key: 'jobTitle', header: 'Job' },
  { key: 'amount', header: 'Amount', className: 'text-right' },
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <Badge variant={statusBadgeVariant(row.status)}>
        {row.status}
      </Badge>
    ),
  },
  { key: 'issuedDate', header: 'Issued' },
  { key: 'dueDate', header: 'Due' },
];

const invoices: Invoice[] = [
  { id: 'INV-001', customer: 'Apex Properties', jobTitle: 'HVAC Installation', amount: '$4,500', status: 'Sent', issuedDate: '2025-01-12', dueDate: '2025-02-12' },
  { id: 'INV-002', customer: 'Summit Office Park', jobTitle: 'Panel Upgrade 200A', amount: '$3,800', status: 'Paid', issuedDate: '2025-01-10', dueDate: '2025-02-10' },
  { id: 'INV-003', customer: 'Harbor View Hotels', jobTitle: 'AC Maintenance', amount: '$850', status: 'Draft', issuedDate: '2025-01-15', dueDate: '2025-02-15' },
  { id: 'INV-004', customer: 'Greenfield School', jobTitle: 'Duct Cleaning', amount: '$1,800', status: 'Paid', issuedDate: '2025-01-08', dueDate: '2025-02-08' },
  { id: 'INV-005', customer: 'Pine Valley HOA', jobTitle: 'Sewer Line Inspection', amount: '$950', status: 'Overdue', issuedDate: '2024-12-15', dueDate: '2025-01-15' },
  { id: 'INV-006', customer: 'Metro Residential', jobTitle: 'Emergency Pipe Repair', amount: '$1,200', status: 'Draft', issuedDate: '2025-01-16', dueDate: '2025-02-16' },
];

export default function InvoicesPage() {
  return (
    <>
      <Header title="Invoices" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary">
              Track and manage billing and invoices
            </p>
          </div>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Invoice
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={invoices}
          searchPlaceholder="Search invoices..."
          searchKey="customer"
        />
      </div>
    </>
  );
}
