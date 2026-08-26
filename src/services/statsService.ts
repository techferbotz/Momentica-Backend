import { STATS } from '../config/constants';
import type { Principal } from '../middleware/principal';
import * as viewRepo from '../repositories/viewRepo';
import * as rsvpRepo from '../repositories/rsvpRepo';
import { getLiveTemplate } from '../templates/registry';
import * as creationService from './creationService';

export interface StatsView {
  totalViews: number;
  daysRemaining: number | null;
  expiresAt: string | null;
  isExpired: boolean;
  series: { date: string; count: number }[];
  rsvp: { yes: number; no: number; maybe: number; guests: number } | null;
}

function startOfUtcDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

/**
 * Fills gaps so the client can draw a continuous chart without knowing which
 * days happened to have traffic.
 */
function densify(rows: { date: Date; count: number }[], days: number): { date: string; count: number }[] {
  const byDay = new Map(rows.map((row) => [row.date.toISOString().slice(0, 10), row.count]));
  const today = startOfUtcDay(new Date());
  const series: { date: string; count: number }[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - offset);
    const key = day.toISOString().slice(0, 10);
    series.push({ date: key, count: byDay.get(key) ?? 0 });
  }
  return series;
}

export async function getStats(principal: Principal, creationId: string): Promise<StatsView> {
  const creation = await creationService.getOwned(principal, creationId);
  const template = getLiveTemplate(creation.templateId);

  const since = startOfUtcDay(new Date());
  since.setUTCDate(since.getUTCDate() - (STATS.dailySeriesDays - 1));

  const rows = await viewRepo.dailySeries(creation.id, since);
  const rsvp = template?.supportsRsvp ? await rsvpRepo.summarize(creation.id) : null;

  const expired = creationService.isExpired(creation);
  const daysRemaining =
    creation.expiresAt && !expired
      ? Math.ceil((creation.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;

  return {
    totalViews: creation.viewCount,
    daysRemaining,
    expiresAt: creation.expiresAt?.toISOString() ?? null,
    isExpired: expired,
    series: densify(rows, STATS.dailySeriesDays),
    rsvp,
  };
}
