import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { ArrowLeft, ArrowRight, AudioLines, BarChart3, BookOpen, BrainCircuit, Check, CheckCheck, ChevronRight, Clock3, Copy, Crown, Flame, Gamepad2, Globe2, HelpCircle, Home, Lightbulb, Link2, LoaderCircle, LockKeyhole, RotateCcw, Settings2, ShieldCheck, Shuffle, Sparkles, Swords, Target, Trophy, Users, Volume2, VolumeX, Wifi, X, Zap } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { Capacitor } from '@capacitor/core';
import { Mascot } from './components/Mascot';
import { Dialog } from './components/Dialog';
import { PwaUpdate } from './components/PwaUpdate';
import { LocalMatch } from './game/localMatch';
import { configureAudio, playSound, unlockAudio } from './lib/audio';
import { clearHistory, createMatchId, getHistory, getPreferences, saveMatch, savePreferences, type Preferences } from './lib/storage';
import { connectForRoom, openConnection, request } from './lib/online';
import { QUESTIONS } from './shared/questions';
import { ROUND_MS, sanitizeName } from './shared/rules';
import type { CategorySelection, Difficulty, MatchConfig, Mode, Player, PublicQuestion, RoomState, RoundResult } from './shared/types';

const categories = [
  { id: 'mixed', title: 'A little of everything', short: 'Mixed', caption: 'Keep your rival guessing', icon: Shuffle, color: 'purple' },
  { id: 'general', title: 'General knowledge', short: 'Knowledge', caption: 'Big world. Bigger questions.', icon: Globe2, color: 'blue' },
  { id: 'puzzles', title: 'Everyday puzzles', short: 'Puzzles', caption: 'Real life. Clever solutions.', icon: Lightbulb, color: 'lime' },
  { id: 'reasoning', title: 'Logical reasoning', short: 'Reasoning', caption: 'Connect the dots.', icon: BrainCircuit, color: 'peach' }
] as const;
const categoryLabel = (id: string) => categories.find(c => c.id === id)?.short ?? id;
type View = 'home' | 'progress' | 'library' | 'play';
const icons = { home: Home, progress: BarChart3, library: BookOpen };

function App() {
  const [view, setView] = useState<View>('home');
  const [prefs, setPrefs] = useState<Preferences>(getPreferences);
  const [config, setConfig] = useState<MatchConfig>({ category: 'mixed', rounds: 5, difficulty: 'medium' });
  const [setup, setSetup] = useState<Mode | null>(null);
  const [overlay, setOverlay] = useState<'settings' | 'rules' | 'leave' | null>(null);
  const [friendName, setFriendName] = useState('Player 2');
  const [joinCode, setJoinCode] = useState('');
  const [joinTab, setJoinTab] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<Mode>('bot');
  const [state, setState] = useState<RoomState | null>(null);
  const [me, setMe] = useState('p1');
  const [clockOffset, setClockOffset] = useState(0);
  const [history, setHistory] = useState(getHistory);
  const [tabletop, setTabletop] = useState(true);
  const engine = useRef<LocalMatch | null>(null);
  const socket = useRef<Socket | null>(null);
  const connectionAttempt = useRef<AbortController | null>(null);
  const runId = useRef('');
  const generation = useRef(0);

  useEffect(() => { savePreferences(prefs); configureAudio(prefs.sound, prefs.haptics); document.documentElement.classList.toggle('reduce-motion', prefs.reducedMotion); }, [prefs]);
  useEffect(() => () => { generation.current++; connectionAttempt.current?.abort(); engine.current?.dispose(); socket.current?.disconnect(); }, []);
  useEffect(() => { if (!message) return; const t = setTimeout(() => setMessage(''), 3500); return () => clearTimeout(t); }, [message]);
  const cleanup = useCallback(() => { generation.current++; connectionAttempt.current?.abort(); connectionAttempt.current = null; engine.current?.dispose(); engine.current = null; socket.current?.removeAllListeners(); socket.current?.disconnect(); socket.current = null; setBusy(false); }, []);
  const home = () => { cleanup(); setState(null); setView('home'); setOverlay(null); setError(''); };
  const prepare = (next: Mode) => { playSound('tap'); unlockAudio(); setError(''); setSetup(next); setJoinTab(false); };
  const startLocal = (next: Exclude<Mode, 'online'>) => {
    cleanup(); unlockAudio(); setMode(next); setMe('p1'); setClockOffset(0); setError('');
    runId.current = createMatchId();
    const match = new LocalMatch(config, [sanitizeName(prefs.name, 'Player 1'), next === 'bot' ? 'Byte' : sanitizeName(friendName, 'Player 2')], next);
    engine.current = match; match.subscribe(setState); setView('play'); setSetup(null);
  };
  const connectOnline = async () => {
    cleanup(); setBusy(true); setError(''); unlockAudio();
    const attempt = generation.current;
    const controller = new AbortController();
    connectionAttempt.current = controller;
    try {
      const client = openConnection(prefs.serverUrl); socket.current = client;
      client.on('server:time', (time: number) => { if (Number.isFinite(time)) setClockOffset(time - Date.now()); });
      client.on('room:state', (next: RoomState) => {
        if (attempt !== generation.current) return;
        if (next.phase === 'countdown' && next.round === 0) runId.current = `${next.code}:${next.startsAt}`;
        setState(next);
      });
      client.on('room:closed', (reason: string) => { if (attempt === generation.current) setError(reason); });
      client.on('disconnect', () => {
        if (attempt !== generation.current) return;
        setError('Connection lost. This match has ended; create a new room when you are connected.');
        setState(old => old ? { ...old, phase: 'abandoned', question: null } : old);
      });
      await connectForRoom(client, controller.signal);
      if (attempt !== generation.current) { client.disconnect(); return; }
      setMe(client.id!);
      await request(client, joinTab ? 'room:join' : 'room:create', joinTab ? { name: prefs.name, code: joinCode.trim().toUpperCase() } : { name: prefs.name, config });
      if (attempt !== generation.current) return;
      setMode('online'); setView('play'); setSetup(null);
    } catch (err) {
      if (attempt === generation.current) { setError(err instanceof Error ? err.message : 'Connection failed.'); socket.current?.removeAllListeners(); socket.current?.disconnect(); socket.current = null; setState(null); }
    } finally { if (attempt === generation.current) { connectionAttempt.current = null; setBusy(false); } }
  };
  const startOnline = async () => {
    if (!socket.current || busy) return;
    setBusy(true); setError('');
    try { await request(socket.current, 'room:start'); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  const answer = (playerId: string, choice: number) => {
    if (mode !== 'online') { if (engine.current?.submit(playerId, choice)) playSound('tap'); }
    else if (socket.current && state?.question) {
      playSound('tap'); void request(socket.current, 'round:answer', { questionId: state.question.id, choice }).catch(err => setError(err.message));
    }
  };
  useEffect(() => {
    if (state?.phase !== 'finished' || !state.history.length) return;
    const player = state.players.find(p => p.id === me); if (!player) return;
    const rival = state.players.find(p => p.id !== me)!;
    saveMatch({ id: runId.current, date: new Date().toISOString(), mode, score: player.score, correct: player.correct, rounds: state.config.rounds, won: player.score > rival.score, draw: player.score === rival.score, averageMs: player.correct ? player.totalMs / player.correct : 0 });
    setHistory(getHistory()); playSound('win');
  }, [state?.phase, state?.history.length, me, mode]);

  const nav = (next: View) => { if (state && view === 'play' && !['finished', 'abandoned'].includes(state.phase)) { setOverlay('leave'); return; } setView(next); playSound('tap'); };
  const totalCorrect = history.reduce((n, h) => n + h.correct, 0);
  const totalRounds = history.reduce((n, h) => n + h.rounds, 0);

  return <MotionConfig reducedMotion={prefs.reducedMotion ? 'always' : 'user'}>
    {!Capacitor.isNativePlatform() && <PwaUpdate matchActive={view === 'play' && !!state && !['finished', 'abandoned'].includes(state.phase)}/>}
    <div className={`app-shell ${view === 'play' ? 'in-game' : ''}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => nav('home')} aria-label="BrainRivals home"><img src="/icon.svg" alt=""/><span>brain<span className="brand-accent">rivals</span><small>THINK FAST. PLAY TOGETHER.</small></span></button>
        <div className="nav-eyebrow">YOUR PLAYGROUND</div>
        <nav aria-label="Main navigation">{(['home', 'progress', 'library'] as const).map(item => { const Icon = icons[item]; return <button key={item} className={`nav-item ${view === item || item === 'home' && view === 'play' ? 'active' : ''}`} onClick={() => nav(item)}><Icon size={20}/><span>{{ home: 'Play', progress: 'Your progress', library: 'Question lab' }[item]}</span>{item === 'home' && <span className="nav-dot"/>}</button>; })}</nav>
        <div className="sidebar-card"><div className="orbit-small"><Sparkles size={21}/></div><h3>A little friendly rivalry.</h3><p>Big questions. Quick thinking.<br/>Better together.</p><button onClick={() => setOverlay('rules')}>How to play <ArrowRight size={16}/></button></div>
        <div className="sidebar-bottom"><button className="nav-item" onClick={() => setOverlay('settings')}><Settings2 size={19}/> Settings</button><span className="version"><span/> OFFLINE READY · v0.1</span></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="mobile-brand"><img src="/icon.svg" alt=""/> brainrivals</div><div className="breadcrumb">Your playground <ChevronRight size={14}/> <strong>{view === 'play' ? 'The arena' : view === 'progress' ? 'Your progress' : view === 'library' ? 'Question lab' : 'Let’s play'}</strong></div><div className="top-actions"><span className="private-label"><ShieldCheck size={14}/> No ads. Just play.</span><button className="icon-button" aria-label={prefs.sound ? 'Mute sound' : 'Enable sound'} onClick={() => { unlockAudio(); setPrefs(p => ({ ...p, sound: !p.sound })); }}>{prefs.sound ? <Volume2 size={19}/> : <VolumeX size={19}/>}</button><button className="profile-button" onClick={() => setOverlay('settings')} aria-label="Edit player profile">{(prefs.name.trim()[0] || 'P').toUpperCase()}</button></div></header>
        <AnimatePresence mode="wait">
          {view === 'home' && <motion.div className="page home-page" key="home" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="welcome"><div><span className="eyebrow">A LITTLE CHALLENGE GOES A LONG WAY</span><h1>Great minds. <span>Better rivals.</span></h1><p>Pick your opponent. Trust your instincts. Make every second count.</p></div><button className="text-button" onClick={() => setOverlay('rules')}><HelpCircle size={16}/> How it works</button></div>
            <section className="hero-card" aria-labelledby="hero-title">
              <div className="hero-noise"/><div className="hero-copy"><div className="hero-pill"><span/> YOUR NEXT FRIENDLY SHOWDOWN</div><h2 id="hero-title">A battle of brains.<br/><span>Not just reflexes.</span></h2><p>Knowledge, everyday puzzles, and a little logic.<br className="desktop-break"/> One right answer. Two players. All the fun.</p><button className="primary hero-cta" onClick={() => prepare('bot')}>Jump into a battle <ArrowRight size={19}/></button><div className="hero-foot"><span><Clock3 size={14}/> 2–3 min matches</span><span><Users size={15}/> Solo or with a friend</span></div></div>
              <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="floating-chip chip-speed"><Zap size={15}/> Quick thinking</div><div className="mascot-halo"/><Mascot className="hero-mascot"/><div className="floating-chip chip-points"><CheckCheck size={18}/><span>Correct answer<small>+1,250 points</small></span></div><span className="art-star star-one">✦</span><span className="art-star star-two">✧</span><span className="art-dot"/></div>
            </section>
            <section className="mode-section" aria-labelledby="mode-title"><div className="section-heading"><h2 id="mode-title">Choose your challenge <span>01</span></h2><span className="muted">Your rivalry, your rules.</span></div><div className="mode-grid">
              <button className="mode-card bot-card" onClick={() => prepare('bot')}><div className="mode-card-top"><div className="mode-icon lime"><Gamepad2 size={25}/></div><span className="mini-tag">SOLO PLAY</span></div><h3>You vs. Byte</h3><p>A friendly bot. Three skill levels.<br/>A worthy little rival.</p><div className="mode-card-bottom"><span><span className="status-dot"/> Works offline</span><div className="round-arrow"><ArrowRight size={18}/></div></div><Mascot kind="bot" className="card-bot"/></button>
              <button className="mode-card local-card" onClick={() => prepare('local')}><div className="mode-card-top"><div className="mode-icon purple"><Swords size={25}/></div><span className="mini-tag">SAME PHONE</span></div><h3>Side-by-side rivals</h3><p>One screen. Two sets of answers.<br/>Settle the friendly debate.</p><div className="mode-card-bottom"><span><span className="status-dot"/> Works offline</span><div className="round-arrow"><ArrowRight size={18}/></div></div></button>
              <button className="mode-card online-card" onClick={() => prepare('online')}><div className="mode-card-top"><div className="mode-icon peach"><Globe2 size={25}/></div><span className="mini-tag">PRIVATE ROOMS</span></div><h3>Rivals, anywhere</h3><p>Share a room code with a friend.<br/>Different phones. Same challenge.</p><div className="mode-card-bottom"><span><Wifi size={13}/> Server connection needed</span><div className="round-arrow"><ArrowRight size={18}/></div></div></button>
            </div></section>
            <section aria-labelledby="category-title"><div className="section-heading"><h2 id="category-title">What’s your strong suit? <span>02</span></h2><span className="muted">Choose a category for your next match</span></div><div className="category-grid">{categories.map(c => <button key={c.id} aria-pressed={config.category === c.id} className={`category-card ${config.category === c.id ? 'selected' : ''}`} onClick={() => { setConfig(p => ({ ...p, category: c.id })); playSound('tap'); }}><div className={`category-icon ${c.color}`}><c.icon size={22}/></div><span><strong>{c.title}</strong><small>{c.caption}</small></span>{config.category === c.id ? <Check size={17} className="selected-check"/> : <ChevronRight size={16} className="muted"/>}</button>)}</div></section>
            <div className="home-bottom"><div className="daily-note"><div className="note-icon"><Lightbulb size={23}/></div><div><strong>Fast is good. Correct is better.</strong><p>Every correct answer earns 1,000 points. Speed adds up to 500 more.</p></div></div><div className="mini-stat"><Trophy size={22}/><span><strong>{history.length}</strong> matches played</span><span className="stat-divider"/><Target size={21}/><span><strong>{totalRounds ? Math.round(totalCorrect / totalRounds * 100) : '—'}{totalRounds > 0 ? '%' : ''}</strong> accuracy</span></div></div>
            <p className="footnote"><ShieldCheck size={13}/> “IQ challenge” is a playful theme, not an IQ test or a medical claim. Just curiosity and good competition.</p>
          </motion.div>}
          {view === 'progress' && <motion.div className="page" key="progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><span className="eyebrow">YOUR PERSONAL SCOREBOARD</span><h1>A little better, <span>every round.</span></h1><p className="page-subtitle">Your last 50 completed matches, saved on this device. Same-phone stats follow Player 1.</p><div className="stat-grid">{[{ name: 'Matches played', value: history.length, icon: Swords }, { name: 'Victories', value: history.filter(h => h.won).length, icon: Trophy }, { name: 'Answer accuracy', value: totalRounds ? `${Math.round(totalCorrect / totalRounds * 100)}%` : '—', icon: Target }, { name: 'Best score', value: history.length ? Math.max(...history.map(h => h.score)).toLocaleString() : '—', icon: Zap }].map(s => <div className="stat-card" key={s.name}><s.icon/><strong>{s.value}</strong><span>{s.name}</span></div>)}</div><div className="section-heading"><h2>Recent battles</h2>{history.length > 0 && <button className="text-button" onClick={() => { clearHistory(); setHistory([]); }}>Clear local history</button>}</div>{history.length ? <div className="history-list">{history.map(h => <div className="history-row" key={h.id}><div className={`history-result ${h.won ? 'lime' : 'purple'}`}>{h.won ? <Trophy size={22}/> : <Swords size={22}/>}</div><div><strong>{h.won ? 'Victory' : h.draw ? 'A perfect tie' : 'Good challenge'}</strong><small>{h.mode === 'bot' ? 'You vs. Byte' : h.mode === 'local' ? 'Same-phone duel' : 'Online room'} · {new Date(h.date).toLocaleDateString()}</small></div><span>{h.correct}/{h.rounds}<small>correct</small></span><strong>{h.score.toLocaleString()}<small>points</small></strong></div>)}</div> : <div className="empty-state"><Mascot kind="bot"/><h2>Your first rivalry starts here.</h2><p>Finish a match to see your results and accuracy.</p><button className="primary" onClick={() => prepare('bot')}>Meet your first rival <ArrowRight size={18}/></button></div>}</motion.div>}
          {view === 'library' && <motion.div className="page" key="library" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><span className="eyebrow">EXPLORE BEFORE YOU COMPETE</span><h1>Curiosity is <span>a superpower.</span></h1><p className="page-subtitle">90 original questions. Three categories. Explanations that make the answer click.</p><QuestionLab/></motion.div>}
          {view === 'play' && state && <motion.div className="page play-page" key="play" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="battle-heading"><button className="text-button" onClick={() => state.phase === 'finished' || state.phase === 'abandoned' ? home() : setOverlay('leave')}><ArrowLeft size={17}/> Leave arena</button><span className="mini-tag">{mode === 'online' ? `ROOM ${state.code}` : mode === 'local' ? 'SAME-PHONE DUEL' : 'YOU VS. BYTE'}</span>{mode === 'local' && <button className="text-button" aria-pressed={tabletop} onClick={() => setTabletop(p => !p)}><RotateCcw size={16}/> {tabletop ? 'Face-to-face' : 'Side-by-side'}</button>}</div>
            {error && <div className="error-banner" role="alert">{error}</div>}
            {state.phase === 'lobby' ? <Lobby state={state} me={me} busy={busy} onStart={startOnline} notify={setMessage}/> : state.phase === 'abandoned' ? <div className="empty-state"><Link2 size={52}/><h1>Connection interrupted.</h1><p>No winner has been recorded for this unfinished match.</p><button className="primary" onClick={home}>Back to playground <ArrowRight size={18}/></button></div> : state.phase === 'finished' ? <Results state={state} me={me} mode={mode} onHome={home} onRematch={() => mode === 'online' ? void startOnline() : startLocal(mode)} busy={busy}/> : <Battle state={state} me={me} mode={mode} offset={clockOffset} tabletop={tabletop} onAnswer={answer}/>}
          </motion.div>}
        </AnimatePresence>
      </main>
      {view !== 'play' && <nav className="bottom-nav" aria-label="Mobile navigation">{(['home', 'progress', 'library'] as const).map(item => { const Icon = icons[item]; return <button key={item} className={view === item ? 'active' : ''} onClick={() => nav(item)}><Icon size={21}/><span>{{ home: 'Play', progress: 'Progress', library: 'Learn' }[item]}</span></button>; })}<button onClick={() => setOverlay('settings')}><Settings2 size={21}/><span>Settings</span></button></nav>}
    </div>
    {setup && <Dialog title={setup === 'bot' ? 'Meet your match.' : setup === 'local' ? 'Bring a worthy rival.' : 'Same challenge. Anywhere.'} onClose={() => { if (busy) cleanup(); setSetup(null); setError(''); }}><p className="dialog-subtitle">{setup === 'bot' ? 'Byte is ready. How about you?' : setup === 'local' ? 'Both players answer at the same time on this phone.' : 'Create a private room or enter a friend’s six-character code.'}</p>
      {setup === 'online' && <div className="segmented"><button className={!joinTab ? 'selected' : ''} onClick={() => { setJoinTab(false); setError(''); }} disabled={busy}>Create room</button><button className={joinTab ? 'selected' : ''} onClick={() => { setJoinTab(true); setError(''); }} disabled={busy}>Join room</button></div>}
      <label className="field">Your name<input value={prefs.name} maxLength={20} onChange={e => setPrefs(p => ({ ...p, name: e.target.value }))} autoComplete="nickname" placeholder="Player 1" disabled={busy}/></label>
      {setup === 'local' && <label className="field">Your rival’s name<input value={friendName} maxLength={20} onChange={e => setFriendName(e.target.value)} placeholder="Player 2"/></label>}
      {setup === 'online' && joinTab ? <label className="field">Room code<input className="code-input" aria-label="Room code" value={joinCode} onChange={e => setJoinCode(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())} placeholder="ABC123" maxLength={6} autoComplete="off" disabled={busy}/></label> : <><label className="field">Question category<select value={config.category} disabled={busy} onChange={e => setConfig(p => ({ ...p, category: e.target.value as CategorySelection }))}>{categories.map(c => <option value={c.id} key={c.id}>{c.title}</option>)}</select></label><fieldset><legend>Match length</legend><div className="segmented">{([5, 10, 15] as const).map(n => <button key={n} disabled={busy} aria-pressed={config.rounds === n} className={config.rounds === n ? 'selected' : ''} onClick={() => setConfig(p => ({ ...p, rounds: n }))}>{n} rounds</button>)}</div></fieldset></>}
      {setup === 'bot' && <fieldset><legend>Byte’s skill level <span>(not question difficulty)</span></legend><div className="segmented">{(['easy', 'medium', 'hard'] as Difficulty[]).map(d => <button key={d} aria-pressed={config.difficulty === d} className={config.difficulty === d ? 'selected' : ''} onClick={() => setConfig(p => ({ ...p, difficulty: d }))}>{d === 'easy' ? 'Chill' : d === 'medium' ? 'Balanced' : 'Sharp'}</button>)}</div></fieldset>}
      {setup === 'local' && <div className="info-note"><Users size={20}/><p>Place the phone between you. Player 2’s controls face the other direction. Switch to side-by-side in the arena if preferred.</p></div>}
      {setup === 'online' && <div className="info-note" role={busy ? 'status' : undefined}><Wifi size={19}/><p>{busy ? 'Connecting to the room server. Free hosting may take up to 90 seconds to wake. You can cancel below.' : 'Online rooms need a connection. On Android, set the hosted HTTPS server address in Settings. A sleeping free server can take about a minute to wake.'}</p></div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <button className="primary full-width" disabled={busy || setup === 'online' && joinTab && joinCode.length !== 6} onClick={() => setup === 'online' ? void connectOnline() : startLocal(setup)}>{busy ? <><LoaderCircle className="spin" size={20}/> Connecting…</> : <>{setup === 'online' ? joinTab ? 'Join the room' : 'Create private room' : 'Let’s play'} <ArrowRight size={19}/></>}</button><p className="tiny-note">15 seconds per question · correct answers first, speed second</p>
      {setup === 'online' && busy && <button className="text-button" onClick={() => { cleanup(); setError(''); }}>Cancel connection</button>}
    </Dialog>}
    {overlay === 'settings' && <Dialog title="Make it your game." onClose={() => setOverlay(null)}><label className="field">Player name<input maxLength={20} value={prefs.name} onChange={e => setPrefs(p => ({ ...p, name: e.target.value }))}/></label>{([{ key: 'sound', title: 'Game sounds', description: 'Original arcade-style tones', icon: AudioLines }, { key: 'haptics', title: 'Haptic feedback', description: 'Subtle taps on supported Android devices', icon: Zap }, { key: 'reducedMotion', title: 'Reduce motion', description: 'Less movement; also respects your device setting', icon: Sparkles }] as const).map(setting => <label className="toggle-row" key={setting.key}><setting.icon size={22}/><span><strong>{setting.title}</strong><small>{setting.description}</small></span><input type="checkbox" checked={prefs[setting.key]} onChange={e => setPrefs(p => ({ ...p, [setting.key]: e.target.checked }))}/></label>)}<label className="field">Online server address<input type="url" placeholder="https://your-game-server.example" value={prefs.serverUrl} onChange={e => setPrefs(p => ({ ...p, serverUrl: e.target.value }))}/><small>Leave empty for browser development via the local proxy. Android requires HTTPS.</small></label><div className="info-note"><ShieldCheck size={20}/><p>Names and match history stay on this device in offline play. Online play sends your chosen name and answers to your configured server. No analytics or advertising SDKs.</p></div><button className="primary full-width" onClick={() => setOverlay(null)}>All set <Check size={18}/></button></Dialog>}
    {overlay === 'rules' && <Dialog title="Two minds. One challenge." onClose={() => setOverlay(null)}><div className="rule-list"><div><span>01</span><p><strong>Choose your rival.</strong> Play against Byte, share one phone, or create a private online room.</p></div><div><span>02</span><p><strong>Think, then tap.</strong> Both players get 15 seconds and one answer each. A wrong answer cannot be changed.</p></div><div><span>03</span><p><strong>Correct beats quick.</strong> A correct answer earns 1,000 + up to 500 speed points. Wrong or late answers earn zero. Both players can score.</p></div><div><span>04</span><p><strong>Learn the why.</strong> Read the explanation after each round. Highest total wins; equal scores are a draw.</p></div></div><div className="info-note"><Clock3 size={21}/><p>Online timing uses the server’s receipt time, so network delay can affect speed points. No cash prizes or IQ scores.</p></div><button className="primary full-width" onClick={() => setOverlay(null)}>Got it. Game on. <Swords size={19}/></button></Dialog>}
    {overlay === 'leave' && <Dialog title="Leave this match?" onClose={() => setOverlay(null)}><p className="dialog-subtitle">This match won’t count in your history. In online mode, leaving ends the room for your friend too.</p><div className="dialog-buttons"><button className="secondary" onClick={() => setOverlay(null)}>Keep playing</button><button className="danger-button" onClick={home}>Leave match</button></div></Dialog>}
    {message && <div className="toast" role="status"><Check size={17}/>{message}</div>}
  </MotionConfig>;
}

function Lobby({ state, me, busy, onStart, notify }: { state: RoomState; me: string; busy: boolean; onStart: () => void; notify: (text: string) => void }) {
  return <div className="lobby"><div className="lobby-orb"><Globe2 size={37}/></div><span className="eyebrow">YOUR PRIVATE ARENA</span><h1>Good rivalry <span>starts here.</span></h1><p>Send this code to a friend. They’ll need the same server address.</p><button className="room-code" aria-label={`Copy room code ${state.code}`} onClick={() => { void navigator.clipboard?.writeText(state.code).then(() => notify('Room code copied.')).catch(() => notify(`Your room code: ${state.code}`)); }}>{state.code}<Copy size={23}/></button><div className="lobby-players">{[0, 1].map(i => { const p = state.players[i]; return <div className="lobby-player" key={i}><div className={`avatar ${i ? 'rival' : ''}`}>{p ? p.name[0].toUpperCase() : <Users/>}</div><strong>{p?.name ?? 'Waiting for your rival…'}</strong><span>{p ? p.id === state.hostId ? 'HOST · READY' : 'READY TO PLAY' : 'SHARE YOUR ROOM CODE'}</span></div>; })}</div><div className="lobby-config"><span><BookOpen size={16}/>{categoryLabel(state.config.category)}</span><span><Swords size={16}/>{state.config.rounds} rounds</span><span><Clock3 size={16}/>15 sec each</span></div>{state.hostId === me ? <button className="primary" disabled={state.players.length !== 2 || busy} onClick={onStart}>{busy ? 'Starting…' : state.players.length !== 2 ? 'Waiting for a friend' : 'Start the showdown'} <ArrowRight size={18}/></button> : <p className="waiting-label"><LoaderCircle size={17} className="spin"/> Waiting for the host to start…</p>}</div>;
}

function useClock(offset: number) { const [time, setTime] = useState(() => Date.now() + offset); useEffect(() => { setTime(Date.now() + offset); const timer = setInterval(() => setTime(Date.now() + offset), 80); return () => clearInterval(timer); }, [offset]); return time; }

function Scoreboard({ players, answered, result, remaining, totalMs }: { players: Player[]; answered: string[]; result: RoundResult | null; remaining: number; totalMs: number }) {
  return <div className="scoreboard">{players.map((p, i) => <div className={`score-player ${i ? 'rival-player' : ''}`} key={p.id}><div className={`avatar ${i ? 'rival' : ''}`}>{p.name[0].toUpperCase()}</div><div><span>{p.name} {answered.includes(p.id) && <LockKeyhole size={12}/>}</span><strong>{p.score.toLocaleString()}</strong>{result && <small className={result.answers.find(a => a.playerId === p.id)?.correct ? 'good' : 'muted'}>+{result.answers.find(a => a.playerId === p.id)?.points ?? 0} this round</small>}</div></div>)}<div className={`round-timer ${remaining <= 5000 ? 'urgent' : ''}`} style={{ '--progress': Math.max(0, Math.min(1, remaining / totalMs)) } as React.CSSProperties}><Clock3 size={14}/><strong>{Math.max(0, Math.ceil(remaining / 1000))}</strong></div></div>;
}

function Battle({ state, me, mode, offset, tabletop, onAnswer }: { state: RoomState; me: string; mode: Mode; offset: number; tabletop: boolean; onAnswer: (id: string, choice: number) => void }) {
  const now = useClock(offset); const [choices, setChoices] = useState<Record<string, number>>({});
  const choicesRef = useRef<Record<string, number>>({});
  const countdown = Math.max(1, Math.ceil((state.startsAt - now) / 1000));
  const remaining = Math.max(0, state.deadline - now);
  useEffect(() => { choicesRef.current = {}; setChoices({}); }, [state.question?.id, state.round]);
  useEffect(() => { if (state.phase === 'countdown') playSound('countdown'); }, [state.phase, countdown]);
  useEffect(() => { if (state.phase === 'question') playSound('go'); if (state.phase === 'reveal') playSound(state.result?.answers.find(a => a.playerId === me)?.correct ? 'correct' : 'wrong'); }, [state.phase, me]);
  const submit = (id: string, value: number) => { if (choicesRef.current[id] !== undefined || state.answeredIds.includes(id) || state.phase !== 'question' || now >= state.deadline) return; choicesRef.current = { ...choicesRef.current, [id]: value }; setChoices(choicesRef.current); onAnswer(id, value); };
  const progress = <div className="round-progress"><span>ROUND <strong>{state.round + 1}</strong> / {state.config.rounds}</span><div>{Array.from({ length: state.config.rounds }, (_, i) => <span className={i < state.round ? 'done' : i === state.round ? 'current' : ''} key={i}/>)}</div><span>{categoryLabel(state.question?.category ?? state.config.category)}</span></div>;
  if (state.phase === 'countdown') return <div className="countdown-screen">{progress}<div className="versus-art"><Mascot/><span>VS</span><Mascot kind="bot"/></div><h2>{state.round === 0 ? 'Meet your rival.' : 'Next question. Fresh chance.'}</h2><p>{state.players[0].name} <span>vs.</span> {state.players[1].name}</p><motion.div key={`${state.round}:${countdown}`} className="countdown-number" initial={{ scale: .65, opacity: .4 }} animate={{ scale: 1, opacity: 1 }}>{countdown}</motion.div><span className="eyebrow">CORRECT FIRST. FAST SECOND.</span></div>;
  const question = state.result?.question ?? state.question;
  if (!question) return null;
  const isReveal = state.phase === 'reveal';
  const board = (id: string, compact = false) => <AnswerBoard key={id} question={question} player={state.players.find(p => p.id === id)!} reveal={state.result} choice={choices[id]} locked={state.answeredIds.includes(id) || choices[id] !== undefined || remaining === 0} compact={compact} onAnswer={value => submit(id, value)}/>;
  return <div className={`battle ${mode === 'local' ? `local-battle ${tabletop ? 'tabletop' : ''}` : ''}`}>{progress}{mode === 'local' ? <><div className="local-top">{board('p2', true)}</div><Scoreboard players={state.players} answered={state.answeredIds} result={state.result} remaining={remaining} totalMs={isReveal ? 4000 : ROUND_MS}/><div className="local-bottom">{board('p1', true)}</div></> : <><Scoreboard players={state.players} answered={state.answeredIds} result={state.result} remaining={remaining} totalMs={isReveal ? 4000 : ROUND_MS}/>{board(me)}{!isReveal && <div className="answer-status" role="status">{state.answeredIds.includes(me) || choices[me] !== undefined ? <><LockKeyhole size={16}/> Answer locked. Waiting for the reveal…</> : <><Zap size={16}/> Pick one. Make it count.</>}</div>}</>}
    <AnimatePresence>{isReveal && state.result && <motion.div className="explanation" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} role="status"><div className="explanation-icon"><Lightbulb size={22}/></div><div><strong>Here’s the why.</strong><p>{state.result.question.explanation}</p><small>{state.round + 1 === state.config.rounds ? 'Results' : 'Next round'} in {Math.ceil(remaining / 1000)}s</small></div></motion.div>}</AnimatePresence>
  </div>;
}

function AnswerBoard({ question, player, reveal, choice, locked, compact, onAnswer }: { question: PublicQuestion; player: Player; reveal: RoundResult | null; choice?: number; locked: boolean; compact: boolean; onAnswer: (choice: number) => void }) {
  const selected = reveal?.answers.find(a => a.playerId === player.id)?.choice ?? choice;
  return <div className={`answer-board ${compact ? 'compact' : ''}`}>
    <div className="question-meta"><span><span className="status-dot"/>{compact ? player.name : categoryLabel(question.category)}</span><span>{compact ? 'YOUR ANSWERS' : `${question.difficulty.toUpperCase()} QUESTION`}</span></div>
    <h2 tabIndex={compact ? 0 : undefined}>{question.prompt}</h2><div className="answer-grid">{question.options.map((option, i) => {
      const correct = reveal && reveal.question.correct === i;
      const wrong = reveal && selected === i && !correct;
      return <button key={i} disabled={!!reveal || locked} onClick={() => onAnswer(i)} className={`answer-option ${correct ? 'correct' : wrong ? 'wrong' : selected === i ? 'locked' : ''}`} aria-label={`${String.fromCharCode(65 + i)}: ${option}${correct ? ', correct answer' : ''}${wrong ? ', your incorrect answer' : ''}`}><span className="answer-letter">{correct ? <Check size={20}/> : wrong ? <X size={20}/> : String.fromCharCode(65 + i)}</span><span>{option}</span>{selected === i && !reveal && <LockKeyhole size={15}/>}</button>;
    })}</div>{compact && <div className="compact-status">{reveal ? reveal.answers.find(a => a.playerId === player.id)?.correct ? `Correct! +${reveal.answers.find(a => a.playerId === player.id)?.points}` : 'No points this round' : locked ? 'Answer locked' : 'Tap your answer'}</div>}
  </div>;
}

function Results({ state, me, mode, onHome, onRematch, busy }: { state: RoomState; me: string; mode: Mode; onHome: () => void; onRematch: () => void; busy: boolean }) {
  const [review, setReview] = useState(false);
  const tied = state.players[0].score === state.players[1].score;
  const winner = [...state.players].sort((a, b) => b.score - a.score)[0];
  return <div className="results"><div className="result-decoration" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ '--i': i } as React.CSSProperties}/>)}</div><div className="trophy-orb"><Trophy size={45}/></div><span className="eyebrow">THAT’S A WRAP</span><h1>{tied ? 'Great minds think alike.' : `${winner.name} takes the crown.`}</h1><p>{tied ? 'Same score. Shared bragging rights.' : 'A little competition. A lot of good thinking.'}</p><div className="result-players">{state.players.map((p, i) => <div className={`result-player ${!tied && p.id === winner.id ? 'winner' : ''}`} key={p.id}><div className={`avatar ${i ? 'rival' : ''}`}>{p.name[0].toUpperCase()}{!tied && p.id === winner.id && <Crown size={19}/>}</div><h3>{p.name}</h3><strong>{p.score.toLocaleString()}</strong><span>POINTS</span><div className="result-detail"><span><Target size={15}/>{p.correct}/{state.config.rounds} correct</span><span><Zap size={15}/>{p.correct ? `${(p.totalMs / p.correct / 1000).toFixed(1)}s avg` : '—'}</span></div></div>)}</div><div className="result-actions">{mode !== 'online' || state.hostId === me ? <button className="primary" onClick={onRematch} disabled={busy}><RotateCcw size={18}/>{busy ? 'Starting…' : 'Run it back'}</button> : <span className="waiting-label">Waiting for the host to start a rematch</span>}<button className="secondary" onClick={onHome}>Back to playground</button></div><button className="text-button review-toggle" aria-expanded={review} onClick={() => setReview(p => !p)}><BookOpen size={17}/>{review ? 'Hide' : 'Review'} all answers <ChevronRight size={16}/></button>{review && <div className="review-list">{state.history.map(r => <article key={r.index}><span className="eyebrow">ROUND {r.index + 1} · {categoryLabel(r.question.category)}</span><h3>{r.question.prompt}</h3><strong className="good"><Check size={15}/> {r.question.options[r.question.correct]}</strong><p>{r.question.explanation}</p><small>{r.answers.map(a => `${state.players.find(p => p.id === a.playerId)?.name}: ${a.choice === null ? 'No answer' : r.question.options[a.choice]} (${a.points} pts)`).join(' · ')}</small></article>)}</div>}<p className="footnote">Scores measure this match—not intelligence. Come back for the fun.</p></div>;
}

function QuestionLab() {
  const [category, setCategory] = useState<CategorySelection>('mixed');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const filtered = QUESTIONS.filter(q => category === 'mixed' || q.category === category);
  const sample = filtered.slice(page * 9, (page + 1) * 9);
  return <><div className="lab-filters">{categories.map(c => <button key={c.id} className={category === c.id ? 'selected' : ''} onClick={() => { setCategory(c.id); setPage(0); setExpanded(null); }}><c.icon size={16}/>{c.short}</button>)}</div><div className="lab-grid">{sample.map(q => <article className="lab-card" key={q.id}><span className="eyebrow">{categoryLabel(q.category)} · {q.difficulty}</span><h3>{q.prompt}</h3><button className="text-button" aria-expanded={expanded === q.id} onClick={() => setExpanded(expanded === q.id ? null : q.id)}>{expanded === q.id ? 'Hide explanation' : 'Reveal the answer'} <Lightbulb size={16}/></button>{expanded === q.id && <div className="lab-explanation"><strong>{q.options[q.correct]}</strong><p>{q.explanation}</p></div>}</article>)}</div><div className="pagination"><button className="secondary" disabled={page === 0} onClick={() => { setPage(p => p - 1); setExpanded(null); }}><ArrowLeft size={16}/> Previous</button><span>{page + 1} / {Math.ceil(filtered.length / 9)}</span><button className="secondary" disabled={(page + 1) * 9 >= filtered.length} onClick={() => { setPage(p => p + 1); setExpanded(null); }}>Next <ArrowRight size={16}/></button></div></>;
}

export default App;