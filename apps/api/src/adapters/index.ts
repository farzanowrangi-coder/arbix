import { BookmakerSlug } from '@arbix/shared';
import { BaseAdapter } from './base';
import { PolymarketAdapter } from './polymarket';
import { PinnacleAdapter } from './pinnacle';
import { DraftKingsAdapter } from './draftkings';
import { FanDuelAdapter } from './fanduel';
import { BetMGMAdapter } from './betmgm';
import { CaesarsAdapter } from './caesars';
import { Bet365Adapter } from './bet365';
import { StakeAdapter } from './stake';
import { BetwayAdapter } from './betway';
import { TheOddsApiAdapter } from './odds-api';

export { BaseAdapter } from './base';
export { PolymarketAdapter } from './polymarket';
export { PinnacleAdapter } from './pinnacle';
export { DraftKingsAdapter } from './draftkings';
export { FanDuelAdapter } from './fanduel';
export { BetMGMAdapter } from './betmgm';
export { CaesarsAdapter } from './caesars';
export { Bet365Adapter } from './bet365';
export { StakeAdapter } from './stake';
export { BetwayAdapter } from './betway';
export { TheOddsApiAdapter } from './odds-api';

export type AdapterConstructor = new () => BaseAdapter;

export const ADAPTER_REGISTRY: Record<BookmakerSlug, AdapterConstructor | null> = {
  odds_api: TheOddsApiAdapter,
  polymarket: PolymarketAdapter,
  pinnacle: PinnacleAdapter,
  draftkings: DraftKingsAdapter,
  fanduel: FanDuelAdapter,
  betmgm: BetMGMAdapter,
  caesars: CaesarsAdapter,
  bet365: Bet365Adapter,
  stake: StakeAdapter,
  betway: BetwayAdapter,
  betrivers: null,
  bovada: null,
  mybookie: null,
  betonline: null,
  espn_bet: null,
  kalshi: null,
  williamhill: null,
  unibet: null,
  bwin: null,
};

export function createAdapter(slug: BookmakerSlug): BaseAdapter | null {
  const Ctor = ADAPTER_REGISTRY[slug];
  if (!Ctor) return null;
  return new Ctor();
}

export function createAllAdapters(slugs?: BookmakerSlug[]): BaseAdapter[] {
  const targets = slugs ?? (Object.keys(ADAPTER_REGISTRY) as BookmakerSlug[]);
  return targets
    .map((slug) => createAdapter(slug))
    .filter((a): a is BaseAdapter => a !== null);
}
