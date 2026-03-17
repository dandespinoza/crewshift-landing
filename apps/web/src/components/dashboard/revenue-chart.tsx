'use client';

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RevenueDataPoint {
  date: string;
  revenue: number;
}

interface RevenueChartProps {
  data: RevenueDataPoint[];
  className?: string;
}

// Design tokens mapped to their raw values for use inside the D3 imperative layer.
// These must stay in sync with tailwind.config.ts.
const TOKEN = {
  accent500:    '#FF751F',
  accent200:    '#FFD0A8',
  accent50:     '#FFF5ED',
  borderSubtle: '#EEEFF1',
  textTertiary: '#6B6B76',
} as const;

const MARGIN = { top: 20, right: 20, bottom: 30, left: 56 };
const CHART_HEIGHT = 250;

function RevenueChart({ data, className }: RevenueChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || data.length === 0) return;

    const container = containerRef.current;
    const svg       = d3.select(svgRef.current);

    const draw = () => {
      const totalWidth  = container.clientWidth;
      const totalHeight = CHART_HEIGHT;
      const innerWidth  = totalWidth  - MARGIN.left - MARGIN.right;
      const innerHeight = totalHeight - MARGIN.top  - MARGIN.bottom;

      // Clear previous render
      svg.selectAll('*').remove();

      svg
        .attr('width',  totalWidth)
        .attr('height', totalHeight)
        .attr('viewBox', `0 0 ${totalWidth} ${totalHeight}`);

      // ── Gradient definition ──────────────────────────────────────────────
      const defs = svg.append('defs');
      const gradientId = 'revenue-area-gradient';

      const gradient = defs
        .append('linearGradient')
        .attr('id', gradientId)
        .attr('x1', '0')
        .attr('y1', '0')
        .attr('x2', '0')
        .attr('y2', '1');

      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', TOKEN.accent200)
        .attr('stop-opacity', 0.4);

      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', TOKEN.accent50)
        .attr('stop-opacity', 0.05);

      // ── Drawing group ────────────────────────────────────────────────────
      const g = svg
        .append('g')
        .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

      // ── Scales ──────────────────────────────────────────────────────────
      const parsedData = data.map((d) => ({
        date:    new Date(d.date),
        revenue: d.revenue,
      }));

      const xScale = d3
        .scaleTime()
        .domain(d3.extent(parsedData, (d) => d.date) as [Date, Date])
        .range([0, innerWidth]);

      const yMax    = d3.max(parsedData, (d) => d.revenue) ?? 0;
      const yScale  = d3
        .scaleLinear()
        .domain([0, yMax * 1.15])
        .nice()
        .range([innerHeight, 0]);

      // ── Horizontal grid lines ────────────────────────────────────────────
      const yTicks = yScale.ticks(5);

      g.selectAll('.grid-line')
        .data(yTicks)
        .enter()
        .append('line')
        .attr('class', 'grid-line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', (d) => yScale(d))
        .attr('y2', (d) => yScale(d))
        .attr('stroke', TOKEN.borderSubtle)
        .attr('stroke-width', 1);

      // ── Area path ────────────────────────────────────────────────────────
      const areaGenerator = d3
        .area<{ date: Date; revenue: number }>()
        .x((d) => xScale(d.date))
        .y0(innerHeight)
        .y1((d) => yScale(d.revenue))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(parsedData)
        .attr('d', areaGenerator)
        .attr('fill', `url(#${gradientId})`);

      // ── Line path ────────────────────────────────────────────────────────
      const lineGenerator = d3
        .line<{ date: Date; revenue: number }>()
        .x((d) => xScale(d.date))
        .y((d) => yScale(d.revenue))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(parsedData)
        .attr('d', lineGenerator)
        .attr('fill', 'none')
        .attr('stroke', TOKEN.accent500)
        .attr('stroke-width', 2);

      // ── X-axis ───────────────────────────────────────────────────────────
      const xAxis = d3
        .axisBottom(xScale)
        .ticks(5)
        .tickSize(0)
        .tickFormat((d) =>
          (d as Date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        );

      const xAxisGroup = g
        .append('g')
        .attr('transform', `translate(0,${innerHeight})`)
        .call(xAxis);

      xAxisGroup.select('.domain').remove();
      xAxisGroup
        .selectAll('text')
        .attr('dy', '1.2em')
        .style('font-size', '12px')
        .style('fill', TOKEN.textTertiary);

      // ── Y-axis ───────────────────────────────────────────────────────────
      const yAxis = d3
        .axisLeft(yScale)
        .ticks(5)
        .tickSize(0)
        .tickFormat((d) => `$${d3.format(',.0f')(d as number)}`);

      const yAxisGroup = g.append('g').call(yAxis);

      yAxisGroup.select('.domain').remove();
      yAxisGroup
        .selectAll('text')
        .attr('dx', '-0.6em')
        .style('font-size', '12px')
        .style('fill', TOKEN.textTertiary);
    };

    draw();

    // Redraw on resize
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);

    return () => observer.disconnect();
  }, [data]);

  return (
    <div className={cn('rounded-lg bg-surface-bg0 p-6 shadow-1', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Revenue (30 Days)</h2>
        <Link
          href="#"
          className="flex items-center gap-1 text-sm text-accent-500 transition-colors hover:text-accent-600"
        >
          View Report
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Chart container */}
      <div ref={containerRef} className="mt-4 w-full">
        <svg ref={svgRef} className="block w-full" />
      </div>
    </div>
  );
}

export { RevenueChart };
export type { RevenueDataPoint, RevenueChartProps };
