'use client';

import { Plus } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data/data-table';
import { Badge } from '@/components/ui/badge';

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: string;
  totalJobs: number;
  totalRevenue: string;
  lastService: string;
  [key: string]: unknown;
}

const columns: Column<Customer>[] = [
  { key: 'name', header: 'Name' },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  {
    key: 'type',
    header: 'Type',
    render: (row) => (
      <Badge variant={row.type === 'Commercial' ? 'accent' : 'default'}>
        {row.type}
      </Badge>
    ),
  },
  { key: 'totalJobs', header: 'Jobs', className: 'text-center' },
  { key: 'totalRevenue', header: 'Revenue', className: 'text-right' },
  { key: 'lastService', header: 'Last Service' },
];

const customers: Customer[] = [
  { id: '1', name: 'Apex Properties', email: 'ops@apexproperties.com', phone: '(555) 100-2000', type: 'Commercial', totalJobs: 12, totalRevenue: '$34,200', lastService: '2025-01-15' },
  { id: '2', name: 'Metro Residential', email: 'maint@metrores.com', phone: '(555) 200-3000', type: 'Commercial', totalJobs: 8, totalRevenue: '$18,600', lastService: '2025-01-14' },
  { id: '3', name: 'Summit Office Park', email: 'facilities@summit.com', phone: '(555) 300-4000', type: 'Commercial', totalJobs: 6, totalRevenue: '$22,800', lastService: '2025-01-12' },
  { id: '4', name: 'Harbor View Hotels', email: 'eng@harborview.com', phone: '(555) 400-5000', type: 'Commercial', totalJobs: 15, totalRevenue: '$42,100', lastService: '2025-01-15' },
  { id: '5', name: 'Elm Street Homes', email: 'john@elmstreet.com', phone: '(555) 500-6000', type: 'Residential', totalJobs: 3, totalRevenue: '$5,400', lastService: '2025-01-10' },
  { id: '6', name: 'Pine Valley HOA', email: 'board@pinevalley.org', phone: '(555) 600-7000', type: 'Residential', totalJobs: 5, totalRevenue: '$8,900', lastService: '2025-01-14' },
  { id: '7', name: 'Greenfield School', email: 'admin@greenfield.edu', phone: '(555) 700-8000', type: 'Commercial', totalJobs: 4, totalRevenue: '$12,600', lastService: '2025-01-10' },
  { id: '8', name: 'Tech Hub Co-work', email: 'ops@techhub.co', phone: '(555) 800-9000', type: 'Commercial', totalJobs: 2, totalRevenue: '$3,200', lastService: '2025-01-08' },
];

export default function CustomersPage() {
  return (
    <>
      <Header title="Customers" />
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary">
              Manage your customer relationships
            </p>
          </div>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Customer
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={customers}
          searchPlaceholder="Search customers..."
          searchKey="name"
        />
      </div>
    </>
  );
}
