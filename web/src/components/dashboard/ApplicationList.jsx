import { Heading } from '../Typography';
import styles from './ApplicationList.module.css';

// Hardcoded mock data — replaced by API call in Phase 10
const MOCK_APPLICATIONS = [
  { id: 1, company: 'Stripe',  role: 'Senior Frontend Engineer',        status: 'interview', appliedAt: 'Mar 18', atsScore: 87 },
  { id: 2, company: 'Linear',  role: 'Product Engineer',                status: 'pending',   appliedAt: 'Mar 15', atsScore: 91 },
  { id: 3, company: 'Vercel',  role: 'Developer Experience Engineer',   status: 'ghosted',   appliedAt: 'Mar 12', atsScore: 74 },
  { id: 4, company: 'Figma',   role: 'Senior Software Engineer',        status: 'rejected',  appliedAt: 'Mar 9',  atsScore: 82 },
  { id: 5, company: 'Notion',  role: 'Full Stack Engineer',             status: 'pending',   appliedAt: 'Mar 7',  atsScore: 79 },
  { id: 6, company: 'Loom',    role: 'Frontend Engineer',               status: 'interview', appliedAt: 'Mar 5',  atsScore: 88 },
];

export default function ApplicationList() {
  return (
    <section className={styles.section}>

      <div className={styles.sectionHeader}>
        <Heading as="h2">Recent Applications</Heading>
        <a href="/dashboard/applications" className={styles.viewAll}>View all →</a>
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
          {MOCK_APPLICATIONS.map((app) => (
            <tr key={app.id}>
              <td>
                <div className={styles.companyCell}>
                  <div className={styles.avatar} aria-hidden="true">
                    {app.company[0]}
                  </div>
                  <span className={styles.companyName}>{app.company}</span>
                </div>
              </td>
              <td><span className={styles.role}>{app.role}</span></td>
              <td><span className={styles.atsScore}>{app.atsScore}</span></td>
              <td>
                <span className={styles.statusBadge} data-status={app.status}>
                  {app.status}
                </span>
              </td>
              <td><span className={styles.date}>{app.appliedAt}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

    </section>
  );
}
