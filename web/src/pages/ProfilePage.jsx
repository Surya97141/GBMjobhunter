import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import ATSRing from '../components/dashboard/ATSRing';
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
        ATS score history appears here once you log applications with a resume uploaded.
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [resume,       setResume]       = useState(null);
  const [atsScore,     setAtsScore]     = useState(0);
  const [applications, setApplications] = useState([]);
  const [loading,      setLoading]      = useState(true);

  useEffect(() => {
    Promise.all([
      client.get('/users/me/resume').catch(() => ({ data: null })),
      client.get('/applications').catch(() => ({ data: null })),
      client.get('/users/me').catch(() => ({ data: null })),
    ]).then(([resumeRes, appsRes, meRes]) => {
      setResume(resumeRes.data?.data?.resume ?? null);
      setApplications(appsRes.data?.data?.applications ?? []);
      setAtsScore(meRes.data?.data?.user?.ats_score_cache ?? 0);
    }).finally(() => setLoading(false));
  }, []);

  function handleUploaded(data) {
    setResume(data.resume);
    setAtsScore(data.ats_score ?? 0);
  }

  if (loading) {
    return <div className={styles.page}><p className={styles.loadingText}>Loading profile…</p></div>;
  }

  return (
    <main className={styles.page}>

      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Profile</h1>
        <p className={styles.pageSubtitle}>
          Upload your resume to unlock ATS scoring on every application you log.
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
            <h2 className={styles.cardTitle}>Resume Quality Score</h2>
            <p className={styles.cardHint}>
              How complete and keyword-rich your resume is. Goes up when you add more skills, experience, and clear role descriptions.
            </p>
            <div className={styles.ringWrap}>
              <ATSRing score={atsScore} />
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>ATS Score History</h2>
            <p className={styles.cardHint}>
              Keyword match % between your resume and each job description you applied to.
            </p>
            <ScoreHistory applications={applications} />
          </section>

        </div>

        {/* Right column: extracted resume data */}
        <div className={styles.rightCol}>

          {resume ? (
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
