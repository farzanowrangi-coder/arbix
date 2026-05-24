'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';

interface Props {
  opportunityId: string;
}

const fetcher = (url: string) => api.get(url).then((r) => r.data.data);

export function AIInsightPanel({ opportunityId }: Props) {
  const [fetch, setFetch] = useState(false);
  const { data, isLoading } = useSWR(
    fetch ? `/arbitrage/opportunities/${opportunityId}/ai` : null,
    fetcher
  );

  return (
    <div className="border border-border bg-card rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-blue-arb text-sm">◎</span>
          <h2 className="text-xs font-bold text-text-primary">AI Analysis</h2>
        </div>
        {!fetch && (
          <button
            onClick={() => setFetch(true)}
            className="text-2xs text-blue-arb border border-blue-arb/30 rounded px-3 py-1 hover:bg-blue-arb/10 transition-colors"
          >
            Analyze with AI
          </button>
        )}
      </div>

      <div className="px-5 py-4">
        {!fetch && (
          <p className="text-2xs text-text-muted">Click "Analyze with AI" to get an explanation of this opportunity, estimated duration, and suspicious line detection.</p>
        )}

        {isLoading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-4 rounded" style={{ width: `${90 - i * 10}%` }} />
            ))}
          </div>
        )}

        {data && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            <p className="text-xs text-text-secondary leading-relaxed">{data.explanation}</p>

            <div className="flex items-center gap-4 pt-2 border-t border-border">
              <div>
                <div className="text-2xs text-text-muted">Estimated Duration</div>
                <div className="text-xs text-blue-arb font-bold">{data.estimatedDurationMinutes}m</div>
              </div>
              {data.suspicious?.suspicious && (
                <div className="px-3 py-1.5 bg-red-arb/10 border border-red-arb/30 rounded text-xs text-red-arb">
                  ⚠ {data.suspicious.reason}
                </div>
              )}
              {!data.suspicious?.suspicious && (
                <div className="px-3 py-1.5 bg-green-arb/10 border border-green-arb/30 rounded text-xs text-green-arb">
                  Lines appear genuine
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
