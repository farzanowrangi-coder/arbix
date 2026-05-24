'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type OddsFormat = 'decimal' | 'american';

const STORAGE_KEY = 'arbix_odds_format';

interface OddsFormatCtx {
  format: OddsFormat;
  setFormat: (f: OddsFormat) => void;
  displayOdds: (decimalOdds: number, americanOdds: number) => string;
}

const OddsFormatContext = createContext<OddsFormatCtx>({
  format: 'decimal',
  setFormat: () => {},
  displayOdds: (dec) => dec.toFixed(3),
});

export function OddsFormatProvider({ children }: { children: React.ReactNode }) {
  const [format, setFormatState] = useState<OddsFormat>('decimal');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as OddsFormat | null;
    if (stored === 'american' || stored === 'decimal') setFormatState(stored);
  }, []);

  const setFormat = useCallback((f: OddsFormat) => {
    setFormatState(f);
    localStorage.setItem(STORAGE_KEY, f);
  }, []);

  const displayOdds = useCallback((decimalOdds: number, americanOdds: number): string => {
    if (format === 'american') {
      return americanOdds > 0 ? `+${americanOdds}` : `${americanOdds}`;
    }
    return decimalOdds.toFixed(3);
  }, [format]);

  return (
    <OddsFormatContext.Provider value={{ format, setFormat, displayOdds }}>
      {children}
    </OddsFormatContext.Provider>
  );
}

export function useOddsFormat() {
  return useContext(OddsFormatContext);
}
