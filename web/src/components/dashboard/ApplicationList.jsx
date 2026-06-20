import { Heading } from '../Typography';
import styles from './ApplicationList.module.css';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ApplicationList({ applications = [], loading = false }) {
  if (loading) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <Heading as="h2">Recent Applications</Heading>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, padding: '16px 0' }}>
          Loading…
        </p>
      </section>
    );
  }

  if (applications.length === 0) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <Heading as="h2">Recent Applications</Heading>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, padding: '16px 0' }}>
          No applications yet. Use the browser extension on a job page to log your first one.
        </p>
      </section>
    );
  }

  const recent = applications.slice(0, 6);

  return (
    <section className={styles.section}>

      <div className={styles.sectionHeader}>
        <Heading as="h2">Recent Applications</Heading>
        <a href="/dashboard/tracker" className={styles.viewAll}>View all →</a>
      </div>

      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr>
            <th>Company</th>
            <th>Role</th>
            <th>ATS</th>
            <th>Status</th>
            <th>Applied</th>
          </tr>
        </thead>
        <tbody className={styles.tbody}>
          {recent.map(app => (
            <tr key={app.id}>
              <td>
                <div className={styles.companyCell}>
                  <div className={styles.avatar} aria-hidden="true">
                    {app.company_name?.[0] ?? '?'}
                  </div>
                  <span className={styles.companyName}>{app.company_name}</span>
                </div>
              </td>
              <td><span className={styles.role}>{app.role_title}</span></td>
              <td>
                <span className={styles.atsScore}>
                  {app.ats_score_at_apply !== null ? app.ats_score_at_apply : '—'}
                </span>
              </td>
              <td>
                <span className={styles.statusBadge} data-status={app.outcome}>
                  {app.outcome}
                </span>
              </td>
              <td><span className={styles.date}>{formatDate(app.applied_at)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

    </section>
  );
}
