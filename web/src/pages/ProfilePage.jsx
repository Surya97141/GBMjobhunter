import { useState, useEffect, useRef, useCallback } from 'react';
import { Display } from '../components/Typography';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import ATSRing from '../components/dashboard/ATSRing';
import ResumeSuggestions from '../components/profile/ResumeSuggestions';
import { initialProfileForm } from '../utils/profileForm';
import client from '../api/client';
import styles from './ProfilePage.module.css';

// ─── Upload dropzone ──────────────────────────────────────────────────────────

function UploadZone({ onUploaded }) {
  const [dragging,    setDragging]    = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const inputRef = useRef(null);

  const doUpload = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') {
      setUploadError('Only PDF files are accepted.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('resume', file);
      const res = await client.post('/users/me/resume', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploaded(res.data.data);
    } catch (err) {
      setUploadError(err.response?.data?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }, [onUploaded]);

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    doUpload(file);
  }

  function onFileChange(e) {
    doUpload(e.target.files[0]);
    e.target.value = '';
  }

  return (
    <div
      className={`${styles.dropzone} ${dragging ? styles.dropzoneDragging : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Upload resume PDF"
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        onChange={onFileChange}
        className={styles.fileInput}
        aria-hidden="true"
      />

      {uploading ? (
        <span className={styles.dropzoneText}>Extracting resume…</span>
      ) : (
        <>
          <span className={styles.dropzoneIcon} aria-hidden="true">↑</span>
          <span className={styles.dropzoneText}>Drop your resume PDF here, or click to browse</span>
          <span className={styles.dropzoneHint}>PDF only · Max 5 MB</span>
        </>
      )}

      {uploadError && (
        <span className={styles.dropzoneError} role="alert">{uploadError}</span>
      )}
    </div>
  );
}

// ─── Skills chips ─────────────────────────────────────────────────────────────

function SkillChips({ skills }) {
  if (!skills?.length) {
    return <p className={styles.emptyNote}>No skills detected in the resume text.</p>;
  }
  return (
    <ul className={styles.chips} aria-label="Extracted skills">
      {skills.map(s => (
        <li key={s} className={styles.chip}>{s}</li>
      ))}
    </ul>
  );
}

// ─── Work experience ──────────────────────────────────────────────────────────

function ExperienceList({ experience }) {
  if (!experience?.length) {
    return <p className={styles.emptyNote}>No work experience entries detected.</p>;
  }
  return (
    <ul className={styles.expList}>
      {experience.map((e, i) => (
        <li key={i} className={styles.expItem}>
          <div className={styles.expHeader}>
            <span className={styles.expRole}>{e.role || '(role not detected)'}</span>
            <span className={styles.expDate}>{e.startDate}{e.endDate ? ` – ${e.endDate}` : ''}</span>
          </div>
          {e.company && <span className={styles.expCompany}>{e.company}</span>}
          {e.description && <p className={styles.expDesc}>{e.description}</p>}
        </li>
      ))}
    </ul>
  );
}

// ─── Education ────────────────────────────────────────────────────────────────

function EducationList({ education }) {
  if (!education?.length) {
    return <p className={styles.emptyNote}>No education entries detected.</p>;
  }
  return (
    <ul className={styles.eduList}>
      {education.map((e, i) => (
        <li key={i} className={styles.eduItem}>
          <span className={styles.eduDegree}>{e.degree}</span>
          {e.institution && <span className={styles.eduInst}>{e.institution}</span>}
          {e.year && <span className={styles.eduYear}>{e.year}</span>}
        </li>
      ))}
    </ul>
  );
}

// ─── ATS score history chart ──────────────────────────────────────────────────

function ScoreHistory({ applications }) {
  // Build chart data from applications that have ats_score_at_apply
  const data = applications
    .filter(a => a.ats_score_at_apply != null)
    .map(a => ({
      name: a.role_title?.slice(0, 20) || 'App',
      score: a.ats_score_at_apply,
      date: new Date(a.applied_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    }))
    .slice(-10); // last 10

  if (!data.length) {
    return (
      <p className={styles.emptyNote}>
        Keyword match history appears here once you log applications with a resume uploaded.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: 'var(--text-muted)' }}
          itemStyle={{ color: 'var(--accent)' }}
        />
        <Line
          type="monotone"
          dataKey="score"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={{ fill: 'var(--accent)', r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Profile edit form ────────────────────────────────────────────────────────

function ProfileEditForm({ initialUser, suggestions }) {
  // Every field is a string: years_of_experience arrives as a number (or null).
  const [form,   setForm]   = useState(() => initialProfileForm(initialUser));
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [saveError, setSaveError] = useState(null);
  // Fields filled from resume suggestions and not yet edited by the user.
  const [fromResume, setFromResume] = useState(() => new Set());

  function handleChange(field) {
    return (e) => {
      setSaved(false);
      setSaveError(null);
      setForm(prev => ({ ...prev, [field]: e.target.value }));
      setFromResume(prev => {
        if (!prev.has(field)) return prev;
        const next = new Set(prev);
        next.delete(field);
        return next;
      });
    };
  }

  // Applies reviewed resume suggestions to the form only — nothing is saved here.
  function applySuggestions(updates) {
    setSaved(false);
    setSaveError(null);
    setForm(prev => ({ ...prev, ...updates }));
    setFromResume(prev => new Set([...prev, ...Object.keys(updates)]));
  }

  const resumeBadge = (field) => fromResume.has(field) && (
    <span className={styles.fromResume}>From resume — review before saving</span>
  );

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const payload = {
        name:                  form.name.trim()               || undefined,
        target_role:           form.target_role.trim()        || undefined,
        target_location:       form.target_location.trim()    || undefined,
        years_of_experience:   form.years_of_experience !== ''
          ? Number(form.years_of_experience)
          : undefined,
        cover_letter_template: form.cover_letter_template.trim() || undefined,
      };
      await client.put('/users/me', payload);
      setSaved(true);
      setFromResume(new Set());
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Save failed — please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>Profile Details</h2>
      <ResumeSuggestions suggestions={suggestions} form={form} onApply={applySuggestions} />
      <form className={styles.editForm} onSubmit={handleSave} noValidate>

        <label className={styles.fieldLabel} htmlFor="pf-name">Display Name {resumeBadge('name')}</label>
        <input
          id="pf-name"
          className={styles.fieldInput}
          type="text"
          value={form.name}
          onChange={handleChange('name')}
          placeholder="Your full name"
          autoComplete="name"
        />

        <label className={styles.fieldLabel} htmlFor="pf-role">Target Role {resumeBadge('target_role')}</label>
        <input
          id="pf-role"
          className={styles.fieldInput}
          type="text"
          value={form.target_role}
          onChange={handleChange('target_role')}
          placeholder="e.g. Senior Frontend Engineer"
        />

        <label className={styles.fieldLabel} htmlFor="pf-location">Target Location {resumeBadge('target_location')}</label>
        <input
          id="pf-location"
          className={styles.fieldInput}
          type="text"
          value={form.target_location}
          onChange={handleChange('target_location')}
          placeholder="e.g. London, Remote"
        />

        <label className={styles.fieldLabel} htmlFor="pf-exp">Years of Experience {resumeBadge('years_of_experience')}</label>
        <input
          id="pf-exp"
          className={styles.fieldInput}
          type="number"
          min="0"
          max="50"
          step="1"
          value={form.years_of_experience}
          onChange={handleChange('years_of_experience')}
          placeholder="e.g. 3"
        />

        <label className={styles.fieldLabel} htmlFor="pf-cl">Cover letter template</label>
        <textarea
          id="pf-cl"
          className={styles.fieldTextarea}
          value={form.cover_letter_template}
          onChange={handleChange('cover_letter_template')}
          placeholder="I am excited to apply for the {{role}} position at {{company}}."
          rows={5}
        />
        <p className={styles.fieldHint}>
          Use {'{{company}}'} and {'{{role}}'} as placeholders — they'll be filled in automatically for each application.
        </p>

        <div className={styles.formFooter}>
          <button
            type="submit"
            className={styles.saveBtn}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>

          {saved && (
            <span className={styles.savedMsg} role="status">
              Saved
            </span>
          )}
          {saveError && (
            <span className={styles.saveErrMsg} role="alert">
              {saveError}
            </span>
          )}
        </div>

      </form>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [resume,       setResume]       = useState(null);
  const [atsScore,     setAtsScore]     = useState(0);
  const [applications, setApplications] = useState([]);
  const [userProfile,  setUserProfile]  = useState(null);
  const [suggestions,  setSuggestions]  = useState(null);
  const [loading,      setLoading]      = useState(true);
  // Which requests failed, so a failure isn't shown as "nothing here yet".
  const [loadErrors,   setLoadErrors]   = useState({});

  useEffect(() => {
    const fail = (key) => (err) => ({ _err: key, status: err.response?.status });
    Promise.all([
      client.get('/users/me/resume').catch(fail('resume')),
      client.get('/applications').catch(fail('apps')),
      client.get('/users/me').catch(fail('user')),
    ]).then(([resumeRes, appsRes, meRes]) => {
      const errs = {};
      // 404 from the resume endpoint means no resume uploaded yet, not an error.
      if (resumeRes._err && resumeRes.status !== 404) errs.resume = true;
      if (appsRes._err) errs.apps = true;
      if (meRes._err)   errs.user = true;

      setResume(resumeRes.data?.data?.resume ?? null);
      setSuggestions(resumeRes.data?.data?.profile_suggestions ?? null);
      setApplications(appsRes.data?.data?.applications ?? []);
      const user = meRes.data?.data?.user ?? null;
      setAtsScore(user?.ats_score_cache ?? 0);
      setUserProfile(user);
      setLoadErrors(errs);
    }).finally(() => setLoading(false));
  }, []);

  function handleUploaded(data) {
    setResume(data.resume);
    setAtsScore(data.completeness_score ?? data.ats_score ?? 0);
    setSuggestions(data.profile_suggestions ?? null);
    // A fresh upload replaces whatever failed to load earlier.
    setLoadErrors(prev => ({ ...prev, resume: false }));
  }

  if (loading) {
    return <main className={styles.page}><p className={styles.loadingText} role="status">Loading profile…</p></main>;
  }

  return (
    <main className={styles.page}>

      <header className={styles.pageHeader}>
        <Display as="h1" className={styles.pageTitle}>Profile</Display>
        <p className={styles.pageSubtitle}>
          Upload your resume to see a keyword match for every application you log.
        </p>
      </header>

      <div className={styles.grid}>

        {/* Left column: upload + ATS ring */}
        <div className={styles.leftCol}>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Resume</h2>
            <UploadZone onUploaded={handleUploaded} />
            {resume && (
              <p className={styles.uploadedNote}>
                Resume uploaded · {resume.skills?.length ?? 0} skills detected
              </p>
            )}
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Resume completeness</h2>
            <p className={styles.cardHint}>
              A rule-based check of what the parser found: skills, work experience, education and amount of detail.
              It is not a score from any applicant tracking system and does not predict screening results.
            </p>
            {loadErrors.user ? (
              <p className={styles.loadError} role="alert">Could not load your score. Try reloading the page.</p>
            ) : (
              <div className={styles.ringWrap}>
                <ATSRing score={atsScore} />
              </div>
            )}
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Keyword match history</h2>
            <p className={styles.cardHint}>
              For each application: the share of the job description&apos;s keywords that also appear in your resume.
              It measures word overlap only; it is not an ATS vendor&apos;s score or a prediction of screening outcomes.
            </p>
            {loadErrors.apps
              ? <p className={styles.loadError} role="alert">Could not load your applications. Try reloading the page.</p>
              : <ScoreHistory applications={applications} />}
          </section>

        </div>

        {/* Right column: profile edit + extracted resume data */}
        <div className={styles.rightCol}>

          {loadErrors.user ? (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Profile Details</h2>
              <p className={styles.loadError} role="alert">
                Could not load your saved profile details. Reload the page before editing so nothing is overwritten.
              </p>
            </section>
          ) : (
            <ProfileEditForm initialUser={userProfile} suggestions={suggestions} />
          )}

          {loadErrors.resume ? (
            <div className={styles.noResume}>
              <p className={styles.loadError} role="alert">
                Could not load your resume details. Try reloading the page.
              </p>
            </div>
          ) : resume ? (
            <>
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Extracted Skills</h2>
                <SkillChips skills={resume.skills} />
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Work Experience</h2>
                <ExperienceList experience={resume.workExperience} />
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Education</h2>
                <EducationList education={resume.education} />
              </section>
            </>
          ) : (
            <div className={styles.noResume}>
              <p className={styles.noResumeText}>
                Upload a PDF resume on the left. We will extract your skills, work experience, and education automatically and use them to score every job you apply to.
              </p>
            </div>
          )}

        </div>

      </div>

    </main>
  );
}
