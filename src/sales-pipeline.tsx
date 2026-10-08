import { Link } from 'react-router-dom';
import { Clock3 } from 'lucide-react';
import type { Lead, Stage } from './domain';
import type { WorkflowLead } from './workflow';
import { ACTIVITY_LABELS } from './workflow';
import { date } from './format';
import { StageBadge } from './ui';
export function sourceLabel(lead: Lead) {
  return lead.is_demo
    ? 'Synthetic lead'
    : lead.website_submission_key
      ? 'Website demo'
      : lead.source === 'meta_instant_form'
        ? 'Meta Instant Form'
        : 'Manual lead';
}
export function elapsed(value: string) {
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 3600000));
  return hours >= 24 ? `${Math.floor(hours / 24)}d` : hours ? `${hours}h` : 'Under 1h';
}
export function LeadQueueCard({
  lead,
  selected,
  href,
  showStage = true,
}: {
  lead: WorkflowLead;
  selected: boolean;
  href: string;
  showStage?: boolean;
}) {
  const open = !['Won', 'Lost', 'Unqualified'].includes(lead.stage),
    overdue = open && lead.follow_up_at && Date.parse(lead.follow_up_at) < Date.now();
  return (
    <Link
      className="lead-work-card"
      to={href}
      aria-label={lead.name}
      aria-current={selected ? 'page' : undefined}
      preventScrollReset
    >
      <div className="queue-name">
        <strong>{lead.name}</strong>
        {showStage && <StageBadge stage={lead.stage} />}
      </div>
      <span className="queue-source">{sourceLabel(lead)}</span>
      <span className="pipeline-age">
        {elapsed(lead.stage_entered_at || lead.received_at)} in {lead.stage}
      </span>
      <span className="last-result">
        {lead.last_activity_kind ? ACTIVITY_LABELS[lead.last_activity_kind] : 'No result recorded'}
        {lead.last_activity_at && <> · {date(lead.last_activity_at, false)}</>}
      </span>
      <span
        className={`queue-next ${overdue ? 'overdue' : open && !lead.follow_up_at ? 'missing' : ''}`}
      >
        <Clock3 size={14} />
        <span>
          {!open ? (
            `Closed · ${lead.stage}`
          ) : lead.follow_up_at ? (
            <>
              {lead.next_task_title || 'Follow up'}
              <small>
                {overdue ? 'Overdue · ' : ''}
                {date(lead.follow_up_at)}
              </small>
            </>
          ) : (
            'No next step'
          )}
        </span>
      </span>
    </Link>
  );
}
export function SalesPipeline({
  columns,
  counts,
  selected,
  leadLink,
  stageLink,
}: {
  columns: { stage: Stage; total: number; rows: WorkflowLead[] }[];
  counts: Record<Stage, number>;
  selected?: string;
  leadLink: (id: string) => string;
  stageLink: (stage: Stage, desk?: boolean) => string;
}) {
  return (
    <>
      <div
        className={`sales-board ${columns.length === 1 ? 'single-stage' : ''}`}
        aria-label="Sales pipeline"
      >
        {columns.map((column) => (
          <section
            className="pipeline-column"
            key={column.stage}
            aria-label={`${column.stage} leads`}
          >
            <div className="pipeline-column-heading">
              <h2>{column.stage}</h2>
              <span className="pipeline-count">{column.total}</span>
            </div>
            <ol className="pipeline-cards">
              {column.rows.map((lead) => (
                <li key={lead.id}>
                  <LeadQueueCard
                    lead={lead}
                    href={leadLink(lead.id)}
                    selected={selected === lead.id}
                    showStage={false}
                  />
                </li>
              ))}
            </ol>
            {!column.total && <p className="pipeline-empty">No leads in this stage</p>}
            {column.total > column.rows.length && (
              <Link className="pipeline-more" to={stageLink(column.stage, true)}>
                View all {column.total} · showing {column.rows.length}
              </Link>
            )}
          </section>
        ))}
      </div>
      <div className="pipeline-outcomes">
        <span>Closed outcomes</span>
        {(['Won', 'Lost', 'Unqualified'] as Stage[]).map((stage) => (
          <Link key={stage} to={stageLink(stage)}>
            <StageBadge stage={stage} />
            <strong>{counts[stage] || 0}</strong>
          </Link>
        ))}
      </div>
      <p className="pipeline-note">
        Cards show current stages. Select a lead to review milestones, log a result or plan
        follow-up.
      </p>
    </>
  );
}
