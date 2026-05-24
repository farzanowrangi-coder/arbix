'use client';

import useSWR from 'swr';
import { useCallback, useState } from 'react';
import type { ArbitrageOpportunity, ArbitrageFilter, PaginatedResponse } from '@arbix/shared';
import { opportunityApi } from '@/lib/api';
import { useOpportunityStore } from '@/store';

const PAGE_SIZE = 25;

async function fetchOpportunities(
  filters: ArbitrageFilter,
  page: number,
): Promise<PaginatedResponse<ArbitrageOpportunity>> {
  const res = await opportunityApi.getAll(filters, page, PAGE_SIZE);
  if (!res.success || !res.data) throw new Error(res.error ?? 'Failed to fetch');
  return res.data;
}

interface UseArbitrageOpportunitiesOptions {
  filters?: ArbitrageFilter;
  page?: number;
}

export function useArbitrageOpportunities(opts?: UseArbitrageOpportunitiesOptions) {
  const [localPage, setLocalPage] = useState(opts?.page ?? 1);
  const page = opts?.page ?? localPage;
  const { filters: storeFilters, liveOpportunities } = useOpportunityStore();
  const filters = opts?.filters ?? storeFilters;

  const swrKey = ['opportunities', filters, page] as const;

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    ([, f, p]) => fetchOpportunities(f, p),
    {
      refreshInterval: 10000, // fallback polling if WS down
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    },
  );

  const nextPage = useCallback(() => {
    if (data?.hasMore) setLocalPage((p) => p + 1);
  }, [data?.hasMore]);

  const prevPage = useCallback(() => {
    setLocalPage((p) => Math.max(1, p - 1));
  }, []);

  const goToPage = useCallback((p: number) => setLocalPage(p), []);
  const stats = null; // fetched separately via /arbitrage/stats

  return {
    opportunities: data?.items ?? [],
    liveOpportunities,
    total: data?.total ?? 0,
    hasMore: data?.hasMore ?? false,
    page,
    pageSize: PAGE_SIZE,
    isLoading,
    error: error?.message ?? null,
    nextPage,
    prevPage,
    goToPage,
    refresh: mutate,
    stats,
  };
}

export function useOpportunity(id: string) {
  const { data, error, isLoading } = useSWR(
    id ? `opportunity-${id}` : null,
    () => opportunityApi.getById(id).then((r) => r.data),
    { revalidateOnFocus: false },
  );

  return { opportunity: data ?? null, isLoading, error: error?.message ?? null };
}
