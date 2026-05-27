/**
 * Pinnacle bet executor via Playwright browser automation.
 *
 * Credentials:
 *   login    = Pinnacle email or username
 *   password = Pinnacle password
 *
 * Places a spread/moneyline bet by driving the Pinnacle website.
 * One persistent browser session per process (reused across bets for the same user).
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from '../logger';
import { getCredentials } from './credentials.service';

const PINNACLE_URL = 'https://www.pinnacle.com';
const LOGIN_URL    = 'https://www.pinnacle.com/en/login/';

interface PinnacleSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  loggedIn: boolean;
}

// One session per user — reused across bets
const sessions = new Map<string, PinnacleSession>();

async function getSession(userId: string, login: string, password: string): Promise<PinnacleSession> {
  const existing = sessions.get(userId);
  if (existing?.loggedIn) {
    // Verify still alive
    try {
      await existing.page.evaluate(() => (globalThis as any).document?.title ?? '');
      return existing;
    } catch {
      sessions.delete(userId);
    }
  }

  // Check for pre-saved session cookies (bypasses login/CAPTCHA entirely)
  const cookieCreds = await getCredentials(userId, 'pinnacle_cookies' as any).catch(() => null);
  const cookieString = cookieCreds?.login ?? null;

  logger.info('[pinnacle] Launching browser session', { userId, cookieAuth: !!cookieString });
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  // Stealth: hide webdriver
  await page.addInitScript(() => { Object.defineProperty((navigator as any), 'webdriver', { get: () => false }); });

  const session: PinnacleSession = { browser, context, page, loggedIn: false };
  sessions.set(userId, session);

  // ── Cookie-based auth (bypasses login/CAPTCHA) ───────────────────────────
  if (cookieString) {
    try {
      const cookies = cookieString.split(';').map((c: string) => {
        const eq = c.indexOf('=');
        const name = c.slice(0, eq).trim();
        const value = c.slice(eq + 1).trim();
        return { name, value, domain: '.pinnacle.com', path: '/' };
      }).filter((c: any) => c.name && c.value);
      await context.addCookies(cookies);
      // Verify the session by navigating to a protected page
      await page.goto(`${PINNACLE_URL}/en/my-account/`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForTimeout(3000);
      const url = page.url();
      if (!url.includes('/login') && !url.includes('/account/login')) {
        session.loggedIn = true;
        logger.info('[pinnacle] Cookie auth successful', { userId, url });
        return session;
      }
      logger.warn('[pinnacle] Cookie auth failed — falling back to form login', { userId, url });
    } catch (err: any) {
      logger.warn('[pinnacle] Cookie injection error', { userId, error: err?.message });
    }
  }

  // ── Form-based login ─────────────────────────────────────────────────────
  logger.info('[pinnacle] Navigating to login page', { userId });
  await page.goto(LOGIN_URL, { waitUntil: 'load', timeout: 40_000 });
  logger.info('[pinnacle] Login page loaded', { userId, url: page.url() });
  // Wait for page JS to render (React SPA needs time after `load`)
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/pinnacle-login-page.png', fullPage: false }).catch(() => {});

  // Dismiss cookie consent — look in header/nav only (not the form), to avoid hitting T&C checkboxes
  const cookieClicked = await page.evaluate(() => {
    // Only look in elements that are NOT inside the login form
    const form = document.querySelector('form');
    const acceptTexts = ['accept all', 'accept', 'agree', 'got it'];
    const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    for (const el of all) {
      if (form && form.contains(el)) continue; // skip elements inside the form
      const txt = (el as HTMLElement).innerText?.trim().toLowerCase() ?? '';
      if (acceptTexts.some(t => txt === t)) {
        (el as HTMLElement).click();
        return (el as HTMLElement).innerText.trim();
      }
    }
    return null;
  }).catch(() => null);
  logger.info('[pinnacle] Cookie consent click attempt', { userId, clicked: cookieClicked });
  if (cookieClicked) await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/pinnacle-after-cookie.png', fullPage: false }).catch(() => {});

  // Fill login form — use click+pressSequentially to trigger React onChange events
  const usernameInput = page.locator('input[name="username"], input[type="text"], input[autocomplete="username"]').first();
  const passwordInput = page.locator('input[name="password"], input[type="password"], input[autocomplete="current-password"]').first();
  await usernameInput.waitFor({ timeout: 10_000 });
  await usernameInput.click();
  await usernameInput.pressSequentially(login, { delay: 50 });
  await page.waitForTimeout(300);
  await passwordInput.click();
  await passwordInput.pressSequentially(password, { delay: 50 });
  await page.waitForTimeout(800);

  // Screenshot to see form state
  await page.screenshot({ path: '/tmp/pinnacle-after-fill.png', fullPage: false }).catch(() => {});

  // Wait for submit button to become enabled (React form validation)
  const submitBtn = page.locator('button[type="submit"]').first();
  await submitBtn.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  // Poll until enabled
  for (let i = 0; i < 20; i++) {
    const isDisabled = await submitBtn.isDisabled().catch(() => true);
    if (!isDisabled) break;
    await page.waitForTimeout(300);
  }
  const isDisabled = await submitBtn.isDisabled().catch(() => true);
  logger.info('[pinnacle] Submitting login form', { userId, buttonDisabled: isDisabled });
  await submitBtn.click({ force: true }).catch(() => page.keyboard.press('Enter'));

  // Wait for redirect away from login
  try {
    await page.waitForURL((url) => !url.href.includes('/login'), { timeout: 30_000 });
    session.loggedIn = true;
    logger.info('[pinnacle] Login successful', { userId });
  } catch {
    await page.screenshot({ path: '/tmp/pinnacle-login-fail.png', fullPage: false }).catch(() => {});
    const text = await page.locator('body').innerText().catch(() => '');
    logger.error('[pinnacle] Login failed', { userId, bodySnippet: text?.slice(0, 400) });
    session.loggedIn = false;
  }

  return session;
}

export interface PinnacleOrderResult {
  success: boolean;
  error?: string;
  betId?: string;
}

export async function placePinnacleBet(params: {
  userId: string;
  login: string;
  password: string;
  eventName: string;   // e.g. "Lakers vs Celtics"
  teamName: string;    // which team/side to bet on
  betType: 'spread' | 'moneyline';
  stake: number;       // USD
  sport: string;       // 'basketball', 'baseball', 'tennis', etc.
  betUrl?: string;     // direct URL to the bet page if available
}): Promise<PinnacleOrderResult> {
  let session: PinnacleSession | null = null;
  try {
    session = await getSession(params.userId, params.login, params.password);
    if (!session.loggedIn) {
      return { success: false, error: 'Pinnacle login failed — check credentials' };
    }

    const page = session.page;

    // Navigate to the event
    if (params.betUrl) {
      await page.goto(params.betUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    } else {
      // Build sport path
      const sportPath = getSportPath(params.sport);
      await page.goto(`${PINNACLE_URL}/en/${sportPath}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    }
    await page.waitForTimeout(2000);

    // Search for the event by team name
    const teamKeyword = params.teamName.split(' ').slice(-1)[0].toLowerCase(); // last word (team name)
    const betRows = page.locator(`[class*="event"], [class*="row"], [data-test*="match"]`);
    const count = await betRows.count();

    let found = false;
    for (let i = 0; i < Math.min(count, 50); i++) {
      const row = betRows.nth(i);
      const text = ((await row.textContent().catch(() => '')) ?? '').toLowerCase();
      if (text.includes(teamKeyword)) {
        // Look for spread/moneyline button near this row
        const betBtn = params.betType === 'spread'
          ? row.locator('[class*="spread"], [class*="handicap"]').first()
          : row.locator('[class*="moneyline"], [class*="win"]').first();

        if (await betBtn.isVisible().catch(() => false)) {
          await betBtn.click();
          found = true;
          break;
        }
      }
    }

    if (!found) {
      // Try clicking by searching event name directly
      const eventText = page.getByText(params.teamName, { exact: false }).first();
      if (await eventText.isVisible().catch(() => false)) {
        await eventText.click();
        await page.waitForTimeout(1000);
        const spreadBtn = page.locator('[class*="spread"], [class*="handicap"]').first();
        if (await spreadBtn.isVisible().catch(() => false)) {
          await spreadBtn.click();
          found = true;
        }
      }
    }

    if (!found) {
      return { success: false, error: `Could not find bet for "${params.teamName}" on Pinnacle page` };
    }

    await page.waitForTimeout(1500);

    // Bet slip should now be open — fill stake
    const stakeInput = page.locator('[class*="stake"] input, [placeholder*="stake" i], [placeholder*="amount" i], input[type="number"]').first();
    if (!await stakeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      return { success: false, error: 'Bet slip did not open' };
    }
    await stakeInput.click({ clickCount: 3 });
    await stakeInput.fill(params.stake.toString());
    await page.waitForTimeout(800);

    // Confirm bet
    const confirmBtn = page.locator('button:has-text("Place bet"), button:has-text("Accept"), button:has-text("Bet"), [class*="confirm"]').first();
    if (!await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      return { success: false, error: 'Confirm button not found in bet slip' };
    }
    await confirmBtn.click();
    await page.waitForTimeout(2000);

    // Check for success/error message
    const successMsg = await page.locator('[class*="success"], [class*="confirmed"], :has-text("accepted")').first().textContent({ timeout: 5000 }).catch(() => null);
    const errorMsg   = await page.locator('[class*="error"], [class*="declined"]').first().textContent({ timeout: 3000 }).catch(() => null);

    if (errorMsg) {
      return { success: false, error: `Pinnacle rejected bet: ${errorMsg}` };
    }

    logger.info('[pinnacle] Bet placed', {
      userId: params.userId,
      eventName: params.eventName,
      teamName: params.teamName,
      stake: params.stake,
      confirmation: successMsg?.slice(0, 100),
    });

    return { success: true };
  } catch (err: any) {
    logger.error('[pinnacle] Bet execution error', { error: err.message });
    return { success: false, error: err.message };
  }
}

function getSportPath(sport: string): string {
  const map: Record<string, string> = {
    basketball: 'basketball',
    baseball:   'baseball',
    hockey:     'hockey',
    soccer:     'soccer',
    football:   'football',
    tennis:     'tennis',
    mma:        'mixed-martial-arts',
    boxing:     'boxing',
  };
  return map[sport.toLowerCase()] ?? sport.toLowerCase();
}

// Fetch Pinnacle account balance via browser session
export async function getPinnacleBalance(params: {
  userId: string;
  login: string;
  password: string;
}): Promise<number | null> {
  try {
    const session = await getSession(params.userId, params.login, params.password);
    if (!session.loggedIn) return null;

    const page = session.page;
    // Navigate to account balance page
    await page.goto('https://www.pinnacle.com/en/my-account/balance/', {
      waitUntil: 'domcontentloaded', timeout: 20_000,
    });
    await page.waitForTimeout(2000);

    // Try common balance selectors
    const selectors = [
      '[class*="balance"] [class*="amount"]',
      '[class*="Balance"]',
      '[data-test*="balance"]',
      '[class*="account-balance"]',
      '[class*="funds"]',
    ];
    for (const sel of selectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        const text = (await el.textContent().catch(() => '')) ?? '';
        const num = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (!isNaN(num)) return num;
      }
    }

    // Fallback: look for any text matching dollar amount near "balance" keyword
    const bodyText = await page.locator('body').textContent().catch(() => '');
    const match = (bodyText ?? '').match(/balance[^$]*\$\s*([\d,]+\.?\d*)/i);
    if (match) return parseFloat(match[1].replace(/,/g, ''));

    return null;
  } catch (err: any) {
    logger.error('[pinnacle] getPinnacleBalance error', { error: err?.message });
    return null;
  }
}

// Check open bets on Pinnacle for any that have been voided.
// Returns list of bet reference strings that were voided.
export async function checkPinnacleVoids(params: {
  userId: string;
  login: string;
  password: string;
}): Promise<string[]> {
  try {
    const session = await getSession(params.userId, params.login, params.password);
    if (!session.loggedIn) return [];

    const page = session.page;
    await page.goto('https://www.pinnacle.com/en/my-bets/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(2000);

    const voidedRefs: string[] = [];
    // Look for bets labeled voided/cancelled
    const voidedRows = page.locator(':has-text("Voided"), :has-text("Cancelled"), :has-text("VOID"), [class*="void"], [class*="cancel"]');
    const count = await voidedRows.count();
    for (let i = 0; i < count; i++) {
      const text = (await voidedRows.nth(i).textContent().catch(() => '')) ?? '';
      if (text.trim()) voidedRefs.push(text.trim().slice(0, 80));
    }
    return voidedRefs;
  } catch {
    return [];
  }
}

export async function closePinnacleSession(userId: string) {
  const s = sessions.get(userId);
  if (s) {
    await s.browser.close().catch(() => {});
    sessions.delete(userId);
  }
}
