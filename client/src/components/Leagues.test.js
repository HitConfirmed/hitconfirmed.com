import { screen, waitFor, fireEvent } from '@testing-library/react';
import Leagues from './Leagues';
import { renderWithRouter, mockFetchRoutes, setLoggedIn, setLoggedOut } from '../testUtils';

afterEach(() => {
  jest.restoreAllMocks();
  setLoggedOut();
});

const SEASONS = [
  { slug: 'sfl-americas-2026', name: 'Street Fighter League: AMERICAS 2026', shortName: 'SFL Americas', region: 'Americas', game: 'Street Fighter 6', startDate: '2026-10-23', endDate: '2026-11-08', teamCount: 6, bettable: 0, status: 'complete' },
  { slug: 'sfl-japan-2026', name: 'Street Fighter League: JAPAN 2026', shortName: 'SFL Japan', region: 'Japan', game: 'Street Fighter 6', startDate: '2026-08-25', endDate: '2026-12-11', teamCount: 2, bettable: 1, status: 'live' },
];
const JAPAN = {
  slug: 'sfl-japan-2026', name: 'Street Fighter League: JAPAN 2026', liquipediaUrl: 'https://liquipedia.net/fighters/x', syncedAt: '2026-11-14T12:00:00Z',
  teams: [
    { id: 1, name: 'REJECT', shortName: 'RC', division: 'Division F', logoUrl: null, players: [{ name: 'Daigo' }, { name: 'Fuudo' }], staff: [] },
    { id: 2, name: 'Nagoya OJA', shortName: 'OJA', division: 'Division F', logoUrl: null, players: [{ name: 'Seiya' }], staff: [] },
  ],
  matches: [
    { id: 10, stage: 'Regular Season', round: 'Week 1', division: 'Division F', date: '2026-08-26', team1Id: 1, team2Id: 2, score1: 40, score2: 0, winnerTeamId: 1, finished: true,
      sets: [{ p1: 'Daigo', p2: 'Seiya', s1: 2, s2: 0 }], market: null },
    { id: 11, stage: 'Regular Season', round: 'Week 10', division: 'Division F', date: '2026-12-11', lockAt: '2026-12-10T15:00:00Z', bestOf: 'Bo4', team1Id: 2, team2Id: 1, finished: false, sets: [],
      market: { id: 77, state: 'open', team1Odds: 2.4, team2Odds: 1.55, poolCents: 0, picks: 0 } },
  ],
  standings: [{ division: 'Division F', rows: [
    { teamId: 1, rank: 1, wins: 1, losses: 0, pf: 40, diff: 40 },
    { teamId: 2, rank: 2, wins: 0, losses: 1, pf: 0, diff: -40 },
  ] }],
};

test('opens the season with live picks, shows odds, results and standings', async () => {
  mockFetchRoutes([['/api/leagues', SEASONS], ['/api/leagues/sfl-japan-2026', JAPAN]]);
  renderWithRouter(<Leagues isLoggedIn={false} />);

  await waitFor(() => expect(screen.getByText('2.40')).toBeInTheDocument());
  expect(screen.getByText('Street Fighter League: JAPAN 2026')).toBeInTheDocument();
  expect(screen.getByText('1.55')).toBeInTheDocument();
  // Week 1 result expands to its individual sets.
  const result = document.querySelector('.lg-result-main');
  expect(result.textContent).toContain('40:0');
  fireEvent.click(result);
  expect(screen.getByText('2 – 0')).toBeInTheDocument();

  // Logged out: choosing a team asks to log in instead of showing a slip.
  fireEvent.click(screen.getByText('2.40').closest('button'));
  expect(screen.getByText(/log in to make picks/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'Standings' }));
  expect(screen.getByText('Division F')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Teams' }));
  expect(screen.getByText('Daigo')).toBeInTheDocument();
});

test('places a pick for the chosen team', async () => {
  setLoggedIn({ userId: 5 });
  const fetch = mockFetchRoutes([
    ['/api/leagues', SEASONS],
    ['/api/leagues/sfl-japan-2026', JAPAN],
    ['/api/leagues/bets', (url, opts) => (opts && opts.method === 'POST' ? { betId: 1 } : [])],
  ]);
  renderWithRouter(<Leagues isLoggedIn />);
  await waitFor(() => expect(screen.getByText('1.55')).toBeInTheDocument());

  fireEvent.click(screen.getByText('1.55').closest('button'));
  fireEvent.click(screen.getByRole('button', { name: /place pick/i }));

  await waitFor(() => {
    const post = fetch.mock.calls.find(([u, o]) => u === '/api/leagues/bets' && o && o.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(post[1].body)).toEqual({ marketId: 77, teamId: 1, amountCents: 5000 });
  });
});
