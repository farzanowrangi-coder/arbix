'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useArbitrageOpportunities } from '@/hooks/useArbitrageOpportunities';
import { FilterPanel } from '@/components/dashboard/FilterPanel';
import { OpportunityRow } from '@/components/dashboard/OpportunityRow';
import type { ArbitrageFilter } from '@arbix/shared';

export default function OpportunitiesPage() {
  const [filters, setFilters] = useState<ArbitrageFilter>({});
  const [page, setPage] = useState(1);
  const { opportunities, total, isLoading } = useArbitrageOpportunities({ filters, page });

  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-text-primary">Arbitrage Opportunities</h1>
          <p className="text-2xs text-text-muted mt-0.5">{total} opportunities found</p>
        </div>
      </div>

      {/* Filters */}
      <FilterPanel filters={filters} onChange={(f) => { setFilters(f); setPage(1); }} />

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-2 bg-panel text-2xs text-text-muted border-b border-border">
          <span>EVENT</span>
          <span>SPORT</span>
          <span>ROI</span>
          <span>PROFIT</span>
          <span>BOOKS</span>
          <span>CONFIDENCE</span>
          <span>AGO</span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center">
            <div className="text-text-muted text-xs animate-pulse">Loading opportunities...</div>
          </div>
        ) : opportunities.length === 0 ? (
          <div className="p-12 text-center text-text-muted text-xs">
            No opportunities match your filters. Try relaxing the minimum ROI.
          </div>
        ) : (
          <AnimatePresence>
            {opportunities.map((opp, i) => (
              <motion.div
                key={opp.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <OpportunityRow opportunity={opp} showLink />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 border border-border rounded text-xs text-text-secondary hover:border-green-arb/40 disabled:opacity-30 transition-colors"
          >
            Prev
          </button>
          <span className="text-xs text-text-muted">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 border border-border rounded text-xs text-text-secondary hover:border-green-arb/40 disabled:opacity-30 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
