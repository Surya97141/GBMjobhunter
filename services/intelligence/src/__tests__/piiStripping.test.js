const { buildSkillCluster, anonymiseCohortId, stripPii } = require('../services/piiStripping');

describe('buildSkillCluster', () => {
  it('normalises, sorts and joins the top 5 skills', () => {
    const cluster = buildSkillCluster({ skills: ['React', 'Node JS', 'SQL'] });
    expect(cluster).toBe('node_js.react.sql');
  });

  it('is order-independent so equivalent resumes land in the same cohort', () => {
    const a = buildSkillCluster({ skills: ['React', 'SQL', 'Node'] });
    const b = buildSkillCluster({ skills: ['Node', 'React', 'SQL'] });
    expect(a).toBe(b);
  });

  it('only considers the first 5 skills', () => {
    const cluster = buildSkillCluster({ skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    expect(cluster).toBe('a.b.c.d.e');
  });

  it.each([null, undefined, {}, { skills: 'react' }])(
    'returns "unknown" when there is no usable skills array (%p)',
    (resume) => {
      expect(buildSkillCluster(resume)).toBe('unknown');
    }
  );
});

describe('anonymiseCohortId', () => {
  it('is deterministic and 16 hex characters', () => {
    const id = anonymiseCohortId('react.sql', 'hash1');
    expect(id).toBe(anonymiseCohortId('react.sql', 'hash1'));
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when either input changes', () => {
    const base = anonymiseCohortId('react.sql', 'hash1');
    expect(anonymiseCohortId('react.node', 'hash1')).not.toBe(base);
    expect(anonymiseCohortId('react.sql', 'hash2')).not.toBe(base);
  });
});

describe('stripPii', () => {
  const event = {
    applicationId:    'app-1',
    userId:           'user-secret-id',
    userEmail:        'person@example.com',
    jdFingerprintHash:'abc123',
    atsScoreAtApply:  72,
    appliedAt:        '2026-01-01T00:00:00.000Z',
  };
  const resume = { name: 'Jane Doe', email: 'jane@example.com', skills: ['React', 'SQL'] };

  it('keeps the analytics fields', () => {
    const out = stripPii(event, resume);
    expect(out).toMatchObject({
      applicationId: 'app-1',
      skillCluster:  'react.sql',
      atsScore:      72,
      outcome:       'pending',
      responseDays:  null,
    });
    expect(out.anonymisedCohortId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('never leaks user identifiers or resume personal data', () => {
    const serialised = JSON.stringify(stripPii(event, resume));
    expect(serialised).not.toContain('user-secret-id');
    expect(serialised).not.toContain('person@example.com');
    expect(serialised).not.toContain('Jane Doe');
    expect(serialised).not.toContain('jane@example.com');
  });

  it('only emits an allow-listed set of fields', () => {
    expect(Object.keys(stripPii(event, resume)).sort()).toEqual([
      'anonymisedCohortId', 'applicationId', 'appliedAt', 'atsPlatform',
      'atsScore', 'outcome', 'responseDays', 'skillCluster',
    ]);
  });

  it('falls back to the "unknown" cluster when there is no resume', () => {
    expect(stripPii(event, null).skillCluster).toBe('unknown');
  });
});
