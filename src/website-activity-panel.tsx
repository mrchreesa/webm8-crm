import { useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Button, Empty, ErrorState, useLoad } from './ui';
import { date } from './format';
import type { WebsiteActivity } from './website-activity';
const duration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
};
export function WebsiteActivityPanel({ leadId }: { leadId: string }) {
  const [params, setParams] = useSearchParams();
  const visit = params.get('activityVisit') || '',
    page = params.get('activityPage') || '1',
    visits = params.get('activityVisits') || '1';
  const query = new URLSearchParams({ visit, page, visits });
  const state = useLoad<WebsiteActivity>(`/leads/${leadId}/website-activity?${query}`, true);
  function navigate(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { preventScrollReset: true });
  }
  const result = state.data;
  return (
    <section className="panel website-activity" aria-labelledby="website-activity-title">
      <div className="panel-heading">
        <div>
          <h2 id="website-activity-title">Website activity</h2>
          <p>Instant Form landing visits around this lead’s submission.</p>
        </div>
        <Button
          variant="ghost"
          onClick={state.refresh}
          disabled={state.loading}
          aria-label="Refresh website activity"
        >
          <RefreshCw size={17} />
        </Button>
      </div>
      <div className="panel-content" aria-busy={state.loading}>
        <p className="alert info">
          These are possible matches, not confirmed activity by this person. Timing and ad tags can
          be shared by several visitors.
        </p>
        {state.loading && (
          <p className="muted" role="status">
            Checking measured visits…
          </p>
        )}
        {state.error && (
          <ErrorState
            error={state.error}
            retry={() => {
              navigate({ activityVisit: '', activityPage: '' });
              state.refresh();
            }}
          />
        )}
        {!state.error && result && (
          <>
            {result.status === 'not_configured' && (
              <Empty title="Website connection is not ready">
                Measured visits will appear once this workspace’s website connection is configured.
              </Empty>
            )}
            {result.status === 'not_applicable' && (
              <Empty title="Timing comparison is for Meta Instant Form leads">
                Demo records and other lead sources are not compared with real website visitors.
              </Empty>
            )}
            {result.status === 'expired' && (
              <Empty title="Outside the measurement retention period">
                Website activity is available for up to 180 days. Missing data does not show whether
                someone visited.
              </Empty>
            )}
            {result.status === 'ready' && (
              <>
                <p className="muted">
                  {result.basis}: {date(result.referenceAt)} · London time. Comparing visits first
                  measured on /demo from 2 minutes before to 10 minutes after. Measurement may start
                  later because of visitor choices or network delays.
                </p>
                {result.truncated && (
                  <p className="alert warning">
                    This busy period reached a search limit. The list and competing-lead counts are
                    incomplete; narrow interpretation to the evidence shown.
                  </p>
                )}
                {result.candidates.length === 0 && (
                  <Empty title="No possible measured visit found">
                    This does not mean the lead never visited. They may have declined measurement,
                    used a blocker, visited outside this window, or arrived before tracking started.
                  </Empty>
                )}
                <ol className="possible-visits">
                  {result.candidates.map((candidate) => (
                    <li key={candidate.sessionId}>
                      <div className="possible-visit-heading">
                        <strong>{candidate.band}</strong>
                        <span className="badge">Possible match</span>
                      </div>
                      <p>
                        {date(candidate.firstReceivedAt)} · {duration(Math.abs(candidate.deltaMs))}{' '}
                        {candidate.deltaMs < 0 ? 'before' : 'after'} {result.basis?.toLowerCase()} ·{' '}
                        {candidate.device}
                      </p>
                      <ul>
                        {candidate.evidence.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                        {candidate.conflicts.map((e) => (
                          <li key={e} className="activity-conflict">
                            {e}
                          </li>
                        ))}
                      </ul>
                      {candidate.competingLeads > 0 && (
                        <p className="activity-conflict">
                          Also fits {candidate.competingLeads} other{' '}
                          {candidate.competingLeads === 1 ? 'lead' : 'leads'} in this period.
                        </p>
                      )}
                      <Button
                        variant="outline"
                        onClick={() =>
                          navigate({ activityVisit: candidate.sessionId, activityPage: '1' })
                        }
                        aria-expanded={visit === candidate.sessionId}
                      >
                        Inspect this visit
                      </Button>
                    </li>
                  ))}
                </ol>
                {(result.total || 0) > 5 && (
                  <nav className="activity-pagination" aria-label="Possible visit pages">
                    <Button
                      variant="outline"
                      disabled={result.page === 1}
                      onClick={() =>
                        navigate({
                          activityVisits: String(result.page! - 1),
                          activityVisit: '',
                          activityPage: '',
                        })
                      }
                    >
                      Previous visits
                    </Button>
                    <span>
                      Page {result.page} of {Math.ceil(result.total! / 5)}
                    </span>
                    <Button
                      variant="outline"
                      disabled={result.page! * 5 >= result.total!}
                      onClick={() =>
                        navigate({
                          activityVisits: String(result.page! + 1),
                          activityVisit: '',
                          activityPage: '',
                        })
                      }
                    >
                      Next visits
                    </Button>
                  </nav>
                )}
                {result.selected && result.selected.sessionId === visit && (
                  <section className="possible-visit-detail" aria-label="Possible visit timeline">
                    <div className="possible-visit-heading">
                      <h3>Measured page history · possible match</h3>
                      <Button
                        variant="ghost"
                        onClick={() => navigate({ activityVisit: '', activityPage: '' })}
                      >
                        Close history
                      </Button>
                    </div>
                    <p className="muted">
                      Same browser session only. Times on pages are estimates; the browser clock
                      supplies click times. Activity inside external demo websites is not measured
                      here.
                    </p>
                    <ol className="activity-pages" start={(result.selected.page - 1) * 25 + 1}>
                      {result.selected.rows.map((row) => (
                        <li key={row.id}>
                          <strong>{row.path}</strong>
                          <p>
                            {duration(row.active_ms)} active
                            {row.telemetry?.journey
                              ? ` · ${duration(row.telemetry.journey.visibleMs)} visible`
                              : ''}{' '}
                            · {row.scroll_depth}% scroll reach
                          </p>
                          <p className="muted">
                            First received {date(row.created_at)} · London time
                          </p>
                          {row.telemetry?.journey?.clicks.length ? (
                            <ol className="activity-clicks">
                              {row.telemetry.journey.clicks.map((click, i) => (
                                <li key={i}>
                                  <time dateTime={new Date(click.at).toISOString()}>
                                    {date(new Date(click.at).toISOString())}
                                  </time>
                                  <span>Clicked {click.name}</span>
                                </li>
                              ))}
                            </ol>
                          ) : Object.keys(row.clicks).length ? (
                            <ul>
                              {Object.entries(row.clicks).map(([name, count]) => (
                                <li key={name}>
                                  {name} × {count} (order unavailable)
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="muted">No clicks recorded on this page.</p>
                          )}
                          {row.telemetry?.journey?.clicksTruncated && (
                            <p className="activity-conflict">
                              This page reached the click timeline limit; later clicks may be
                              absent.
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                    {result.selected.total > 25 && (
                      <nav className="activity-pagination" aria-label="Measured page groups">
                        <Button
                          variant="outline"
                          disabled={result.selected.page === 1}
                          onClick={() =>
                            navigate({ activityPage: String(result.selected!.page - 1) })
                          }
                        >
                          Earlier pages
                        </Button>
                        <span>{result.selected.total} measured pages</span>
                        <Button
                          variant="outline"
                          disabled={result.selected.page * 25 >= result.selected.total}
                          onClick={() =>
                            navigate({ activityPage: String(result.selected!.page + 1) })
                          }
                        >
                          Later pages
                        </Button>
                      </nav>
                    )}
                    <a
                      className="activity-report-link"
                      href={result.selected.analyticsPath}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open full Analytics report in a new tab ↗
                    </a>
                  </section>
                )}
                <p className="muted activity-freshness">
                  Checked {date(result.checkedAt)} · London time. Updates every 20 seconds while
                  visible. No lead identity or conversion is assigned from this comparison.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
