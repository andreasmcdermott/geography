"use client";

/* eslint-disable @next/next/no-img-element -- these are tiny self-hosted SVG study assets, not photographic content */

import { useEffect, useMemo, useState } from "react";
import { countries, Country } from "./countries";
import MapQuestionCard from "./MapQuestionCard";

type Topic = "flags" | "capitals" | "map";
type Direction = "country-to-answer" | "answer-to-country";
type View = "learn" | "countries";
type SyncStatus = "syncing" | "synced" | "local" | "error";
type QuizMode = "adaptive" | "region" | "elimination";
type EliminationStyle = "guided" | "free";
type RegionFilter = "All" | "Africa" | "Americas" | "Asia" | "Europe" | "Oceania";
type QuizLength = 20 | 30 | 40 | 50 | "all";

type CountryProgress = {
  attempts: number;
  correct: number;
  streak: number;
  mastered: boolean;
};

type Progress = Record<Topic, Record<string, CountryProgress>>;

type Question = {
  country: Country;
  direction: Direction;
  options: Country[];
};

type QuizState = {
  mode: QuizMode;
  eliminationStyle: EliminationStyle;
  region: RegionFilter;
  questions: Question[];
  index: number;
  score: number;
  attempts: number;
  freeRemainingCodes: string[];
  selectedCode: string | null;
  complete: boolean;
};

const STORAGE_KEY = "wayfinder-geography-progress-v1";
const emptyProgress: Progress = { flags: {}, capitals: {}, map: {} };
const regionFilters: RegionFilter[] = ["All", "Africa", "Americas", "Asia", "Europe", "Oceania"];
const quizLengths: QuizLength[] = [20, 30, 40, 50, "all"];
const countryLookup = new Map(countries.map((country) => [country.code, country]));

function mergeProgress(local: Progress, remote: Progress): Progress {
  const merged: Progress = { flags: {}, capitals: {}, map: {} };
  for (const topic of ["flags", "capitals", "map"] as Topic[]) {
    const codes = new Set([...Object.keys(local[topic] ?? {}), ...Object.keys(remote[topic] ?? {})]);
    for (const code of codes) {
      const localRecord = local[topic]?.[code];
      const remoteRecord = remote[topic]?.[code];
      if (!localRecord && remoteRecord) merged[topic][code] = remoteRecord;
      else if (!remoteRecord && localRecord) merged[topic][code] = localRecord;
      else {
        if (!localRecord || !remoteRecord) continue;
        merged[topic][code] = {
          attempts: Math.max(localRecord.attempts, remoteRecord.attempts),
          correct: Math.max(localRecord.correct, remoteRecord.correct),
          streak: Math.max(localRecord.streak, remoteRecord.streak),
          mastered: localRecord.mastered || remoteRecord.mastered,
        };
      }
    }
  }
  return merged;
}

function normalizeProgress(value: unknown): Progress | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Progress>;
  if (!candidate.flags || typeof candidate.flags !== "object" || !candidate.capitals || typeof candidate.capitals !== "object") return null;
  return {
    flags: candidate.flags,
    capitals: candidate.capitals,
    map: candidate.map && typeof candidate.map === "object" ? candidate.map : {},
  };
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeQuestion(country: Country, direction: Direction, optionPool = countries): Question {
  const distractors = shuffle(optionPool.filter((item) => item.code !== country.code)).slice(0, 3);
  return { country, direction, options: shuffle([country, ...distractors]) };
}

function buildQuiz(topic: Topic, length: QuizLength, progress: Progress, mode: QuizMode, region: RegionFilter): Question[] {
  const regionalPool = region === "All" ? countries : countries.filter((country) => country.region === region);
  const available = mode === "adaptive"
    ? countries.filter((country) => !progress[topic][country.code]?.mastered)
    : regionalPool;
  const shuffled = shuffle(available);
  const pool = mode === "elimination" || length === "all" ? shuffled : shuffled.slice(0, Math.min(length, shuffled.length));
  const optionPool = mode === "region" ? regionalPool : countries;
  const eliminationAnswerOrder = mode === "elimination" ? shuffle(regionalPool) : [];
  const firstDirection: Direction = Math.random() > 0.5 ? "country-to-answer" : "answer-to-country";

  return pool.map((country, index) => {
    const direction = index % 2 === 0
      ? firstDirection
      : firstDirection === "country-to-answer"
        ? "answer-to-country"
        : "country-to-answer";

    if (mode === "elimination") {
      const usedCodes = new Set(pool.slice(0, index).map((item) => item.code));
      return { country, direction, options: eliminationAnswerOrder.filter((item) => !usedCodes.has(item.code)) };
    }

    return makeQuestion(country, direction, optionPool);
  });
}

function plural(value: number, word: string) {
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}

function FlagImage({ code, label, className = "" }: { code: string; label?: string; className?: string }) {
  return (
    <img
      className={`flag-image ${className}`}
      src={`/flags/${code.toLocaleLowerCase()}.svg`}
      alt={label ?? ""}
      draggable={false}
    />
  );
}

export default function QuizApp() {
  const [topic, setTopic] = useState<Topic>("flags");
  const [view, setView] = useState<View>("learn");
  const [quizMode, setQuizMode] = useState<QuizMode>("adaptive");
  const [eliminationStyle, setEliminationStyle] = useState<EliminationStyle>("guided");
  const [region, setRegion] = useState<RegionFilter>("All");
  const [quizLength, setQuizLength] = useState<QuizLength>(20);
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [hydrated, setHydrated] = useState(false);
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [search, setSearch] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("syncing");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      let localProgress = emptyProgress;
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const parsed = stored ? (JSON.parse(stored) as unknown) : null;
        const normalized = normalizeProgress(parsed);
        if (normalized) localProgress = normalized;
      } catch {
        // Keep a clean slate if browser storage is unavailable or malformed.
      }
      setProgress(localProgress);
      setHydrated(true);
      void (async () => {
        try {
          const response = await fetch("/api/progress", { headers: { Accept: "application/json" } });
          if (response.status === 401) {
            setSyncStatus("local");
            return;
          }
          if (!response.ok) throw new Error("Progress could not be loaded");
          const payload = (await response.json()) as { progress?: unknown };
          const remoteProgress = normalizeProgress(payload.progress) ?? emptyProgress;
          const merged = mergeProgress(localProgress, remoteProgress);
          setProgress(merged);

          const saveResponse = await fetch("/api/progress", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ progress: merged }),
          });
          if (!saveResponse.ok) throw new Error("Progress could not be merged");
          setSyncStatus("synced");
        } catch {
          setSyncStatus("error");
        }
      })();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress, hydrated]);

  async function syncAnswer(topicName: Topic, countryCode: string, correctAnswer: boolean) {
    try {
      const response = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topicName, countryCode, correct: correctAnswer }),
      });
      if (!response.ok) throw new Error("Answer could not be saved");
      const payload = (await response.json()) as { record?: CountryProgress | null };
      if (payload.record) {
        setProgress((current) => ({
          ...current,
          [topicName]: { ...current[topicName], [countryCode]: payload.record as CountryProgress },
        }));
      }
      setSyncStatus("synced");
    } catch {
      setSyncStatus("error");
    }
  }

  const stats = useMemo(() => {
    const topicProgress = progress[topic];
    const mastered = countries.filter((country) => topicProgress[country.code]?.mastered).length;
    const attempts = Object.values(topicProgress).reduce((sum, item) => sum + item.attempts, 0);
    const correct = Object.values(topicProgress).reduce((sum, item) => sum + item.correct, 0);
    return { mastered, remaining: countries.length - mastered, attempts, accuracy: attempts ? Math.round((correct / attempts) * 100) : 0 };
  }, [progress, topic]);

  const availableCount = useMemo(() => {
    if (quizMode === "adaptive") return stats.remaining;
    return region === "All" ? countries.length : countries.filter((country) => country.region === region).length;
  }, [quizMode, region, stats.remaining]);

  const sessionCount = quizMode === "elimination" || quizLength === "all" ? availableCount : Math.min(quizLength, availableCount);

  function chooseTopic(nextTopic: Topic) {
    setTopic(nextTopic);
    if (nextTopic !== "flags" && quizMode === "elimination") setQuizMode("region");
    setQuiz(null);
    setView("learn");
  }

  function startQuiz() {
    const questions = buildQuiz(topic, quizLength, progress, quizMode, region);
    setQuiz({
      mode: quizMode,
      eliminationStyle,
      region: quizMode === "adaptive" ? "All" : region,
      questions,
      index: 0,
      score: 0,
      attempts: 0,
      freeRemainingCodes: questions.map((question) => question.country.code),
      selectedCode: null,
      complete: questions.length === 0,
    });
  }

  function recordAnswer(topicName: Topic, countryCode: string, isCorrect: boolean) {
    setProgress((current) => {
      const old = current[topicName][countryCode] ?? { attempts: 0, correct: 0, streak: 0, mastered: false };
      const streak = isCorrect ? old.streak + 1 : 0;
      return {
        ...current,
        [topicName]: {
          ...current[topicName],
          [countryCode]: {
            attempts: old.attempts + 1,
            correct: old.correct + (isCorrect ? 1 : 0),
            streak,
            mastered: streak >= 3,
          },
        },
      };
    });
    void syncAnswer(topicName, countryCode, isCorrect);
  }

  function answer(code: string) {
    if (!quiz || quiz.selectedCode) return;
    const question = quiz.questions[quiz.index];
    const isCorrect = code === question.country.code;

    setQuiz({ ...quiz, selectedCode: code, score: quiz.score + (isCorrect ? 1 : 0) });
    recordAnswer(topic, question.country.code, isCorrect);
  }

  function answerFreePick(flagCode: string, countryCode: string) {
    if (!quiz || quiz.mode !== "elimination" || quiz.eliminationStyle !== "free" || !quiz.freeRemainingCodes.includes(flagCode)) return;
    const isCorrect = flagCode === countryCode;
    const remainingCodes = isCorrect ? quiz.freeRemainingCodes.filter((code) => code !== flagCode) : quiz.freeRemainingCodes;
    setQuiz({
      ...quiz,
      attempts: quiz.attempts + 1,
      score: quiz.score + (isCorrect ? 1 : 0),
      freeRemainingCodes: remainingCodes,
      complete: isCorrect && remainingCodes.length === 0,
    });
    recordAnswer("flags", flagCode, isCorrect);
  }

  function nextQuestion() {
    if (!quiz) return;
    const atEnd = quiz.index === quiz.questions.length - 1;
    setQuiz(atEnd ? { ...quiz, complete: true } : { ...quiz, index: quiz.index + 1, selectedCode: null });
  }

  async function resetTopic() {
    if (!window.confirm(`Reset all ${topic} progress on every device?`)) return;
    setSyncStatus("syncing");
    try {
      const response = await fetch(`/api/progress?topic=${topic}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Progress could not be reset");
      setProgress((current) => ({ ...current, [topic]: {} }));
      setQuiz(null);
      setSyncStatus("synced");
    } catch {
      setSyncStatus("error");
    }
  }

  if (quiz) {
    return (
      <main className="app-shell quiz-shell">
        <header className="topbar compact-topbar">
          <button className="brand-button" onClick={() => setQuiz(null)} aria-label="Return to dashboard">
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <span>Wayfinder</span>
          </button>
          {!quiz.complete && quiz.questions.length > 0 && (quiz.mode === "elimination" && quiz.eliminationStyle === "free" ? (
            <div className="quiz-position" aria-label={`${quiz.freeRemainingCodes.length} flags remaining`}><span>{quiz.freeRemainingCodes.length}</span> remaining</div>
          ) : (
            <div className="quiz-position" aria-label={`Question ${quiz.index + 1} of ${quiz.questions.length}`}><span>{quiz.index + 1}</span> / {quiz.questions.length}</div>
          ))}
          <button className="quiet-button" onClick={() => setQuiz(null)}>Exit quiz</button>
        </header>

        {quiz.complete ? (
          <QuizComplete
            topic={topic}
            score={quiz.score}
            total={quiz.mode === "elimination" && quiz.eliminationStyle === "free" ? quiz.attempts : quiz.questions.length}
            remaining={countries.length - Object.values(progress[topic]).filter((item) => item.mastered).length}
            canRepeat={quiz.mode !== "adaptive" || countries.length - Object.values(progress[topic]).filter((item) => item.mastered).length > 0}
            onAgain={startQuiz}
            onHome={() => setQuiz(null)}
          />
        ) : quiz.mode === "elimination" && quiz.eliminationStyle === "free" ? (
          <FreePickQuiz
            boardCodes={quiz.questions.map((question) => question.country.code)}
            remainingCodes={quiz.freeRemainingCodes}
            score={quiz.score}
            attempts={quiz.attempts}
            onAttempt={answerFreePick}
          />
        ) : topic === "map" ? (
          <MapQuestionCard
            country={quiz.questions[quiz.index].country}
            index={quiz.index}
            total={quiz.questions.length}
            selectedCode={quiz.selectedCode}
            region={quiz.region}
            prompt={quiz.questions[quiz.index].direction === "country-to-answer" ? "country" : "flag"}
            onAnswer={answer}
            onNext={nextQuestion}
          />
        ) : (
          <QuestionCard
            topic={topic}
            quiz={quiz}
            onAnswer={answer}
            onNext={nextQuestion}
          />
        )}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand-button" onClick={() => setView("learn")} aria-label="Wayfinder home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Wayfinder</span>
        </button>
        <nav className="main-nav" aria-label="Primary navigation">
          <button className={view === "learn" ? "active" : ""} onClick={() => setView("learn")}>Learn</button>
          <button className={view === "countries" ? "active" : ""} onClick={() => setView("countries")}>All countries</button>
        </nav>
        <div className={`device-note ${syncStatus}`} role="status">
          <span aria-hidden="true">●</span>
          {syncStatus === "synced" ? "Saved to your account" : syncStatus === "syncing" ? "Syncing progress…" : syncStatus === "local" ? "Saved on this device" : "Account sync paused"}
        </div>
      </header>

      {view === "countries" ? (
        <CountryLibrary search={search} onSearch={setSearch} progress={progress} topic={topic} />
      ) : (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">A little geography, every day</p>
              <h1>Know the world<br /><em>at a glance.</em></h1>
            </div>
            <p className="hero-copy">Build lasting recall with quick, adaptive quizzes. The things you know make room for the things you don’t.</p>
          </section>

          <section className="study-grid" aria-label="Quiz setup">
            <div className="topic-panel">
              <div className="section-heading">
                <span>01</span>
                <div><h2>Choose your study set</h2><p>Progress is kept separately for each set.</p></div>
              </div>
              <div className="topic-cards">
                <button className={`topic-card flag-card ${topic === "flags" ? "selected" : ""}`} onClick={() => chooseTopic("flags")}>
                  <span className="selection-dot" aria-hidden="true" />
                  <span className="card-label">Flags</span>
                  <span className="flag-stack" aria-hidden="true">
                    <b><FlagImage code="JP" /></b><b><FlagImage code="BR" /></b><b><FlagImage code="KE" /></b>
                  </span>
                  <strong>See it.<br />Name it.</strong>
                  <small>Country ↔ Flag</small>
                </button>
                <button className={`topic-card capital-card ${topic === "capitals" ? "selected" : ""}`} onClick={() => chooseTopic("capitals")}>
                  <span className="selection-dot" aria-hidden="true" />
                  <span className="card-label">Capitals</span>
                  <span className="city-lines" aria-hidden="true"><i>OSLO</i><i>NAIROBI</i><i>TOKYO</i></span>
                  <strong>Place the<br />capital.</strong>
                  <small>Country ↔ Capital</small>
                </button>
                <button className={`topic-card map-card ${topic === "map" ? "selected" : ""}`} onClick={() => chooseTopic("map")}>
                  <span className="selection-dot" aria-hidden="true" />
                  <span className="card-label">Map</span>
                  <span className="map-motif" aria-hidden="true"><i /><i /><i /></span>
                  <strong>Find it.<br />Place it.</strong>
                  <small>Country / Flag → Location</small>
                </button>
              </div>
            </div>

            <aside className="session-panel">
              <div className="section-heading">
                <span>02</span>
                <div>
                  <h2>{quizMode === "adaptive" ? "Set your pace" : quizMode === "elimination" ? "Build an elimination quiz" : "Build a region test"}</h2>
                  <p>{quizMode === "adaptive" ? "Mastered countries stay retired." : quizMode === "elimination" ? "The answer bank shrinks as you go." : "Mastery is ignored in test mode."}</p>
                </div>
              </div>
              <div className={`mode-picker ${topic === "flags" ? "three-modes" : ""}`} role="group" aria-label="Quiz mode">
                <button className={quizMode === "adaptive" ? "active" : ""} onClick={() => setQuizMode("adaptive")} aria-pressed={quizMode === "adaptive"}>
                  <strong>Adaptive</strong><span>Learn what’s left</span>
                </button>
                <button className={quizMode === "region" ? "active" : ""} onClick={() => setQuizMode("region")} aria-pressed={quizMode === "region"}>
                  <strong>Region test</strong><span>Include everything</span>
                </button>
                {topic === "flags" && (
                  <button className={quizMode === "elimination" ? "active" : ""} onClick={() => setQuizMode("elimination")} aria-pressed={quizMode === "elimination"}>
                    <strong>Elimination</strong><span>Use the full answer bank</span>
                  </button>
                )}
              </div>
              {quizMode === "elimination" && (
                <div className="elimination-style-picker" role="group" aria-label="Elimination style">
                  <button className={eliminationStyle === "guided" ? "active" : ""} onClick={() => setEliminationStyle("guided")} aria-pressed={eliminationStyle === "guided"}>
                    <strong>Guided</strong><span>Wayfinder chooses</span>
                  </button>
                  <button className={eliminationStyle === "free" ? "active" : ""} onClick={() => setEliminationStyle("free")} aria-pressed={eliminationStyle === "free"}>
                    <strong>Free pick</strong><span>Choose any flag</span>
                  </button>
                </div>
              )}
              {quizMode !== "adaptive" && (
                <div className="region-picker" role="group" aria-label="Region">
                  {regionFilters.map((item) => (
                    <button key={item} className={region === item ? "active" : ""} onClick={() => setRegion(item)} aria-pressed={region === item}>
                      {item === "All" ? "All regions" : item}
                    </button>
                  ))}
                </div>
              )}
              {quizMode !== "elimination" && (
                <div className="length-picker" role="group" aria-label="Quiz length">
                  {quizLengths.map((length) => (
                    <button key={length} className={quizLength === length ? "active" : ""} onClick={() => setQuizLength(length)} aria-pressed={quizLength === length}>
                      {length === "all" ? "All" : length}
                    </button>
                  ))}
                </div>
              )}
              <div className="session-summary">
                <div><span>{quizMode === "elimination" && eliminationStyle === "free" ? "Flags on board" : "Today’s set"}</span><strong>{sessionCount}</strong><small>{quizMode === "elimination" && eliminationStyle === "free" ? "flags" : "questions"}</small></div>
                <div><span>{quizMode === "adaptive" ? "Still learning" : quizMode === "elimination" ? eliminationStyle === "free" ? "Country choices" : "Starting choices" : "Available"}</span><strong>{availableCount}</strong><small>countries</small></div>
              </div>
              <button className="start-button" onClick={startQuiz} disabled={availableCount === 0 || syncStatus === "syncing"}>
                <span>
                  {syncStatus === "syncing"
                    ? "Syncing progress…"
                    : availableCount === 0
                      ? "Set mastered"
                      : quizMode === "elimination"
                        ? `Start ${region === "All" ? "world" : region} ${eliminationStyle === "free" ? "free-pick" : "guided"} quiz`
                        : quizMode === "region"
                        ? `Start ${region === "All" ? "world" : region} ${topic === "flags" ? "flag" : topic === "capitals" ? "capital" : "map"} test`
                        : `Start ${topic === "flags" ? "flag" : topic === "capitals" ? "capital" : "map"} quiz`}
                </span>
                <b aria-hidden="true">↗</b>
              </button>
              <p className="adaptive-note">
                <span aria-hidden="true">✦</span>
                {quizMode === "adaptive"
                  ? topic === "map"
                    ? "Prompts alternate between country names and flags, and retire after a 3-answer streak."
                    : "Questions alternate direction and retire after a 3-answer streak."
                  : quizMode === "elimination"
                    ? eliminationStyle === "free"
                      ? `Choose any remaining flag from ${region === "All" ? "the world" : region}, then search the unused country names for its match.`
                      : `Every unused flag or country in ${region === "All" ? "the world" : region} remains available until its turn is complete.`
                  : topic === "map"
                    ? `Includes mastered countries from ${region === "All" ? "every region" : region} and alternates country-name and flag prompts.`
                    : `Includes mastered countries from ${region === "All" ? "every region" : region} and alternates both directions.`}
              </p>
            </aside>
          </section>

          <section className="progress-strip">
            <div className="progress-title"><span>03</span><div><h2>Your {topic === "map" ? "map" : topic} progress</h2><p>{stats.attempts ? `${stats.accuracy}% accuracy across ${plural(stats.attempts, "answer")}` : "Your first answer starts the story."}</p></div></div>
            <div className="mastery-meter">
              <div className="meter-label"><span>Mastered</span><strong>{stats.mastered} <small>/ {countries.length}</small></strong></div>
              <div className="meter-track"><span style={{ width: `${(stats.mastered / countries.length) * 100}%` }} /></div>
            </div>
            <button className="text-button" onClick={() => setView("countries")}>View country library <span>→</span></button>
            {stats.attempts > 0 && <button className="reset-button" onClick={() => void resetTopic()}>Reset {topic}</button>}
          </section>
        </>
      )}
      <footer><span>Made for curious minds.</span><span><a href="/licenses/flag-icons-MIT.txt">Flags by flag-icons · MIT</a> · <a href="/licenses/natural-earth-public-domain.txt">Map by Natural Earth</a></span><span>{countries.length} countries · Flags, capitals & maps</span></footer>
    </main>
  );
}

function FreePickQuiz({ boardCodes, remainingCodes, score, attempts, onAttempt }: { boardCodes: string[]; remainingCodes: string[]; score: number; attempts: number; onAttempt: (flagCode: string, countryCode: string) => void }) {
  const [selectedFlag, setSelectedFlag] = useState<Country | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ chosen: Country; correct: boolean } | null>(null);
  const remainingSet = useMemo(() => new Set(remainingCodes), [remainingCodes]);
  const remainingCountries = useMemo(
    () => remainingCodes.map((code) => countryLookup.get(code)).filter((country): country is Country => Boolean(country)).sort((a, b) => a.name.localeCompare(b.name)),
    [remainingCodes],
  );
  const filteredCountries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? remainingCountries.filter((country) => country.name.toLocaleLowerCase().includes(normalized)) : remainingCountries;
  }, [query, remainingCountries]);

  function returnToBoard() {
    setSelectedFlag(null);
    setResult(null);
    setQuery("");
  }

  function chooseCountry(country: Country) {
    if (!selectedFlag || result) return;
    const correct = selectedFlag.code === country.code;
    setResult({ chosen: country, correct });
    onAttempt(selectedFlag.code, country.code);
  }

  if (selectedFlag) {
    return (
      <section className="question-wrap free-pick-wrap">
        <div className="question-progress"><span style={{ width: `${(score / boardCodes.length) * 100}%` }} /></div>
        <div className="question-kicker"><span>Free-pick elimination</span><i /><span>{remainingCodes.length} flags remaining</span></div>
        <div className="free-pick-selected"><FlagImage code={selectedFlag.code} label="Selected flag" /></div>
        <h1>Which country uses this flag?</h1>

        {result ? (
          <div className={`free-pick-result ${result.correct ? "success" : "error"}`} role="status">
            <strong>{result.correct ? `Matched: ${selectedFlag.name}` : `${result.chosen.name} isn’t the match.`}</strong>
            <p>{result.correct ? "This pair has been removed from the board." : "The flag stays on the board so you can return to it later."}</p>
            <div>
              {!result.correct && <button className="secondary-action" onClick={() => { setResult(null); setQuery(""); }}>Try this flag again</button>}
              <button className="start-button" onClick={returnToBoard}><span>{result.correct ? "Choose another flag" : "Back to flag board"}</span><b>→</b></button>
            </div>
          </div>
        ) : (
          <>
            <div className="free-country-toolbar">
              <label><span>Filter by country name</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Start typing a country…" /></label>
              <button className="quiet-button" onClick={returnToBoard}>Back to flags</button>
            </div>
            <div className="free-country-list" aria-label="Unused country choices">
              {filteredCountries.map((country) => (
                <button key={country.code} onClick={() => chooseCountry(country)}><strong>{country.name}</strong><span>{country.region}</span></button>
              ))}
            </div>
            {filteredCountries.length === 0 && <div className="empty-state">No remaining countries match “{query}”.</div>}
          </>
        )}
      </section>
    );
  }

  return (
    <section className="question-wrap free-pick-wrap">
      <div className="question-progress"><span style={{ width: `${(score / boardCodes.length) * 100}%` }} /></div>
      <div className="free-pick-board-heading">
        <div><p className="eyebrow">Free-pick elimination</p><h1>Choose a flag you know.</h1><p>Correct pairs disappear. Empty spaces preserve every remaining flag’s position.</p></div>
        <div><strong>{remainingCodes.length}</strong><span>remaining</span><small>{attempts ? `${Math.round((score / attempts) * 100)}% accuracy` : "No attempts yet"}</small></div>
      </div>
      <div className="free-flag-board" aria-label={`${remainingCodes.length} unmatched flags`}>
        {boardCodes.map((code, index) => {
          const country = countryLookup.get(code);
          if (!country) return null;
          const matched = !remainingSet.has(code);
          return matched ? <span className="matched-flag-slot" key={code} aria-hidden="true" /> : (
            <button key={code} onClick={() => { setSelectedFlag(country); setQuery(""); setResult(null); }} aria-label={`Choose flag ${index + 1}`}>
              <FlagImage code={code} label={`Flag choice ${index + 1}`} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function QuestionCard({ topic, quiz, onAnswer, onNext }: { topic: Topic; quiz: QuizState; onAnswer: (code: string) => void; onNext: () => void }) {
  const question = quiz.questions[quiz.index];
  const answered = quiz.selectedCode !== null;
  const isCorrect = quiz.selectedCode === question.country.code;
  const countryFirst = question.direction === "country-to-answer";
  const isElimination = quiz.mode === "elimination";
  const displayedOptions = isElimination && !countryFirst
    ? [...question.options].sort((a, b) => a.name.localeCompare(b.name))
    : question.options;
  const prompt = topic === "flags"
    ? countryFirst ? `Which flag belongs to ${question.country.name}?` : "Which country uses this flag?"
    : countryFirst ? `What is the capital of ${question.country.name}?` : `Which country has ${question.country.capital} as its capital?`;

  return (
    <section className={`question-wrap ${isElimination ? "elimination-wrap" : ""}`}>
      <div className="question-progress"><span style={{ width: `${((quiz.index + (answered ? 1 : 0)) / quiz.questions.length) * 100}%` }} /></div>
      <div className="question-kicker"><span>{topic === "flags" ? "Flag study" : "Capital study"}</span><i /> <span>{countryFirst ? "Country → answer" : "Answer → country"}</span></div>
      {!countryFirst && topic === "flags" && <div className="question-flag"><FlagImage code={question.country.code} label="Flag to identify" /></div>}
      <h1>{prompt}</h1>
      <p className="question-hint">{isElimination ? `${question.options.length} unused ${countryFirst ? "flags" : "countries"} remain.` : "Choose the best answer."}</p>
      {answered && isElimination && <AnswerFeedback isCorrect={isCorrect} question={question} atEnd={quiz.index === quiz.questions.length - 1} onNext={onNext} floating />}
      <div className={`answer-grid ${topic === "flags" && countryFirst ? "flag-options" : ""} ${isElimination ? "elimination-options" : ""} ${isElimination && !countryFirst ? "country-options" : ""}`}>
        {displayedOptions.map((option, index) => {
          const selected = quiz.selectedCode === option.code;
          const correctOption = answered && option.code === question.country.code;
          const wrongOption = answered && selected && !correctOption;
          return (
            <button
              key={option.code}
              className={`${selected ? "selected" : ""} ${correctOption ? "correct" : ""} ${wrongOption ? "wrong" : ""}`}
              onClick={() => onAnswer(option.code)}
              disabled={answered}
            >
              {!isElimination && <span className="answer-key">{String.fromCharCode(65 + index)}</span>}
              {topic === "flags" && countryFirst ? (
                <FlagImage code={option.code} label={`Flag option ${index + 1}`} className="answer-flag" />
              ) : (
                <span className="answer-text">{countryFirst ? option.capital : option.name}</span>
              )}
              {correctOption && <span className="answer-mark">✓</span>}
              {wrongOption && <span className="answer-mark">×</span>}
            </button>
          );
        })}
      </div>
      {answered && !isElimination && <AnswerFeedback isCorrect={isCorrect} question={question} atEnd={quiz.index === quiz.questions.length - 1} onNext={onNext} />}
    </section>
  );
}

function AnswerFeedback({ isCorrect, question, atEnd, onNext, floating = false }: { isCorrect: boolean; question: Question; atEnd: boolean; onNext: () => void; floating?: boolean }) {
  return (
    <div className={`feedback ${isCorrect ? "success" : "error"} ${floating ? "floating-feedback" : ""}`} role="status">
      <div><strong>{isCorrect ? "That’s right." : "Not quite."}</strong><span><FlagImage code={question.country.code} /> {question.country.name} · {question.country.capital}</span></div>
      <button onClick={onNext}>{atEnd ? "See results" : "Next question"} <span>→</span></button>
    </div>
  );
}

function QuizComplete({ topic, score, total, remaining, canRepeat, onAgain, onHome }: { topic: Topic; score: number; total: number; remaining: number; canRepeat: boolean; onAgain: () => void; onHome: () => void }) {
  const percent = total ? Math.round((score / total) * 100) : 100;
  return (
    <section className="complete-card">
      <div className="complete-burst" aria-hidden="true">✦</div>
      <p className="eyebrow">Session complete</p>
      <h1>{total ? (percent >= 80 ? "Nicely navigated." : "Every answer counts.") : "You’ve mastered this set."}</h1>
      <p>{total ? `You scored ${score} out of ${total} in your ${topic} session.` : `There are no ${topic} left in your learning queue.`}</p>
      <div className="score-ring"><strong>{percent}%</strong><span>accuracy</span></div>
      <div className="complete-stats"><div><strong>{score}</strong><span>correct</span></div><div><strong>{remaining}</strong><span>still learning</span></div></div>
      <div className="complete-actions"><button className="start-button" onClick={onAgain} disabled={!canRepeat}>Study another set <b>↗</b></button><button className="quiet-button" onClick={onHome}>Back to dashboard</button></div>
    </section>
  );
}

function CountryLibrary({ search, onSearch, progress, topic }: { search: string; onSearch: (value: string) => void; progress: Progress; topic: Topic }) {
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? countries.filter((country) => [country.name, country.capital, country.region].some((value) => value.toLocaleLowerCase().includes(query))) : countries;
  }, [search]);

  return (
    <section className="library">
      <div className="library-heading"><div><p className="eyebrow">The whole world</p><h1>Country library</h1><p>Browse every flag and capital in the study set.</p></div><label className="search-box"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search country, capital, or region" /></label></div>
      <div className="library-meta"><span>{filtered.length} of {countries.length} countries</span><span>Showing mastery for <b>{topic}</b></span></div>
      <div className="country-grid">
        {filtered.map((country) => {
          const record = progress[topic][country.code];
          return <article className="country-row" key={country.code}><FlagImage code={country.code} label={`Flag of ${country.name}`} className="library-flag" /><div><strong>{country.name}</strong><span>{country.region}</span></div><p>{country.capital}</p><span className={`status-pill ${record?.mastered ? "mastered" : record?.attempts ? "learning" : "new"}`}>{record?.mastered ? "Mastered" : record?.attempts ? `${record.streak}/3 streak` : "New"}</span></article>;
        })}
      </div>
      {filtered.length === 0 && <div className="empty-state">No countries match “{search}”.</div>}
    </section>
  );
}
