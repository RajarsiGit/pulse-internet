import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, ArrowUpRight, Check, CircleHelp, Clock3, Globe2, LoaderCircle, Radio, RotateCw, ShieldCheck, Square, Wifi, WifiOff, Zap } from 'lucide-react';
import { friendlyError, probe, runSpeedTest, checkGlobalLatency, GLOBAL_LOCATIONS } from './network.js';
const empty = { download: null, upload: null, latency: null, jitter: null, bytes: 0 };
const number = value => value == null || !Number.isFinite(value) ? '—' : value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString();
const phases = ['latency', 'download', 'upload'];
const phaseLabels = { idle: 'Ready when you are', latency: 'Measuring latency', download: 'Testing download', upload: 'Testing upload', done: 'Test complete', stopped: 'Test stopped', error: 'Test interrupted' };

function Gauge({ value, phase, busy }) {
  const position = value == null ? 0 : Math.min(1, Math.log10(1 + value) / 3);
  return <div className="gauge"><svg viewBox="0 0 420 320" role="img" aria-label={value == null ? 'Speed not yet measured' : `${number(value)} megabits per second`}>
    <path className="gauge-track" d="M67 246 A165 165 0 1 1 353 246"/><path className="gauge-fill" d="M67 246 A165 165 0 1 1 353 246" pathLength="100" strokeDasharray={`${position * 100} 100`}/>
    {Array.from({ length: 51 }, (_, i) => { const a = (150 + i * 4.8) * Math.PI / 180, major = i % 10 === 0; return <line key={i} x1={210 + Math.cos(a) * 143} y1={164 + Math.sin(a) * 143} x2={210 + Math.cos(a) * (major ? 131 : 136)} y2={164 + Math.sin(a) * (major ? 131 : 136)} stroke={value != null && i / 50 <= position ? '#d7fb67' : '#454a4d'} strokeWidth={major ? 2 : 1}/>; })}
    <text x="39" y="281">0</text><text x="23" y="131">3</text><text x="116" y="33">15</text><text x="300" y="33">62</text><text x="397" y="131">250</text><text x="374" y="281">1k+</text>
    </svg><div className="gauge-reading"><span className="eyebrow">{phase === 'upload' ? 'UPLOAD SPEED' : 'DOWNLOAD SPEED'}</span><div className="gauge-number">{number(value)}</div><span className="unit">Mbps</span><div className="gauge-state">{busy ? <LoaderCircle size={14} className="animate-spin"/> : phase === 'done' ? <Check size={14}/> : <Activity size={14}/>} {phaseLabels[phase]}</div></div></div>;
}
function Metric({ title, icon: Icon, value, unit, detail, active, accent }) {
  return <div className={`metric ${active ? 'metric-active' : ''}`}><div className="flex items-center justify-between gap-2"><span className="metric-label">{title}</span><Icon size={18} className={accent ? 'text-lime' : 'text-muted'}/></div><div className="metric-reading"><span>{number(value)}</span><span className="metric-unit">{unit}</span></div><p>{detail}</p></div>;
}
function ThroughputChart({ samples, busy }) {
  const maxTime = Math.max(20, ...samples.map(s => s.time)), maxValue = Math.max(10, ...samples.map(s => s.value)) * 1.15;
  return <div className="chart-area"><div className="chart-heading"><div><h2>Speed over time</h2><p>{samples.length ? busy ? 'Measuring your connection in real time' : 'Measurements from this test' : 'See your connection take shape.'}</p></div><div className="legend"><span><i className="bg-lime"/>Download</span><span><i className="bg-blue"/>Upload</span></div></div><div className="chart-wrap"><span className="chart-y">{samples.length ? `${Math.ceil(maxValue)} Mbps` : 'Mbps'}</span><svg viewBox="0 0 760 122" preserveAspectRatio="none" role="img" aria-label={samples.length ? 'Cumulative download and upload throughput over time' : 'No speed measurements yet'}>
    {[0, .5, 1].map(f => <line key={f} x1="0" x2="760" y1={f * 122} y2={f * 122} stroke="#303537" strokeDasharray="4 6"/>)}
    {['download','upload'].map(type => <polyline key={type} points={samples.filter(s => s.type === type).map(s => `${s.time / maxTime * 760},${122 - s.value / maxValue * 114}`).join(' ')} fill="none" stroke={type === 'download' ? '#d7fb67' : '#83adff'} strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>)}
    </svg>{!samples.length && <div className="chart-empty"><Activity size={19}/>Waiting for a speed test</div>}</div><div className="chart-x"><span>0s</span><span>{Math.round(maxTime / 2)}s</span><span>{Math.round(maxTime)}s</span></div></div>;
}
function GlobalReach() {
  const [latencies, setLatencies] = useState({});
  const [running, setRunning] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    checkGlobalLatency(controller.signal, entry => setLatencies(previous => ({ ...previous, [entry.id]: entry.latency })))
      .catch(() => {}).finally(() => { if (!controller.signal.aborted) setRunning(false); });
    return () => controller.abort();
  }, []);
  return <section className="global-reach" aria-labelledby="global-reach-title">
    <div className="global-reach-heading"><h3 id="global-reach-title"><Globe2 size={14}/>Global reach</h3><span className="small-tag">{running ? 'MEASURING' : 'LATENCY BY REGION'}</span></div>
    <ul className="global-reach-grid">{GLOBAL_LOCATIONS.map(location => { const value = latencies[location.id];
      return <li key={location.id}><span className="global-reach-label">{location.label}</span><span className="global-reach-value">{value === undefined ? <LoaderCircle size={11} className="animate-spin"/> : value === null ? 'Unreachable' : `${Math.round(value)} ms`}</span></li>; })}</ul>
  </section>;
}
function useConnection(busy) {
  const [status, setStatus] = useState(navigator.onLine ? 'checking' : 'offline'), [checked, setChecked] = useState(null), [online, setOnline] = useState(navigator.onLine), [network, setNetwork] = useState(navigator.connection?.type || null);
  const active = useRef(null), checking = useRef(false);
  const check = useCallback(async () => {
    if (busy || checking.current) return;
    if (!navigator.onLine) { setStatus('offline'); setOnline(false); return; }
    active.current?.abort(); const controller = new AbortController(); active.current = controller; checking.current = true; setStatus('checking');
    try { await probe(controller.signal); if (!controller.signal.aborted) { setStatus('online'); setChecked(Date.now()); } }
    catch { if (!controller.signal.aborted) { setStatus(navigator.onLine ? 'unreachable' : 'offline'); setChecked(Date.now()); } }
    finally { if (active.current === controller) checking.current = false; }
  }, [busy]);
  useEffect(() => {
    if (busy) { active.current?.abort(); checking.current = false; return; }
    check(); const interval = setInterval(() => { if (!document.hidden) check(); }, 15000);
    const changed = () => { setOnline(navigator.onLine); if (navigator.onLine) check(); else { active.current?.abort(); checking.current = false; setStatus('offline'); } };
    const visible = () => { if (!document.hidden) check(); };
    window.addEventListener('online', changed); window.addEventListener('offline', changed); document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(interval); active.current?.abort(); checking.current = false; window.removeEventListener('online', changed); window.removeEventListener('offline', changed); document.removeEventListener('visibilitychange', visible); };
  }, [busy, check]);
  useEffect(() => { const listener = () => { setOnline(navigator.onLine); setNetwork(navigator.connection?.type || null); };
    window.addEventListener('online', listener); window.addEventListener('offline', listener); navigator.connection?.addEventListener('change', listener);
    return () => { window.removeEventListener('online', listener); window.removeEventListener('offline', listener); navigator.connection?.removeEventListener('change', listener); };
  }, []);
  return { status, checked, check, online, network };
}
export default function App() {
  const [phase, setPhase] = useState('idle'), [result, setResult] = useState(empty), [current, setCurrent] = useState(null), [progress, setProgress] = useState(0), [samples, setSamples] = useState([]), [error, setError] = useState('');
  const controller = useRef(null), stateRef = useRef({ phase, result }); stateRef.current = { phase, result };
  const busy = phases.includes(phase), connection = useConnection(busy);
  const start = useCallback(async () => {
    if (controller.current) return { status: 'already_running' };
    if (!navigator.onLine) { setError('You’re offline. Reconnect to the internet, then start a new test.'); return { status: 'offline' }; }
    const run = new AbortController(); controller.current = run;
    setResult({ ...empty }); setCurrent(null); setSamples([]); setError(''); setProgress(0); setPhase('latency');
    try { const final = await runSpeedTest(run.signal, update => { if (run.signal.aborted) return;
      setPhase(update.phase); setProgress(update.progress); setResult(update.result);
      if (update.current !== undefined) setCurrent(update.current);
      if (update.sample) setSamples(previous => [...previous.slice(-239), update.sample]);
    }); if (!run.signal.aborted) { setResult(final); setCurrent(final.download); setProgress(100); setPhase('done'); } return { status: 'complete', ...final };
    } catch (failure) { setCurrent(null); if (run.signal.aborted) { setPhase('stopped'); return { status: 'stopped' }; } setError(friendlyError(failure)); setPhase('error'); return { status: 'error', message: friendlyError(failure) }; }
    finally { if (controller.current === run) controller.current = null; }
  }, []);
  const stop = useCallback(() => controller.current?.abort(), []);
  useEffect(() => { const offline = () => { if (controller.current) { controller.current.abort(); setError('Your device went offline. Reconnect and run a new test.'); } };
    window.addEventListener('offline', offline); return () => { window.removeEventListener('offline', offline); controller.current?.abort(); };
  }, []);
  useEffect(() => {
    const context = document.modelContext; if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const toolDefs = [{ name: 'read_connection_test', description: 'Read displayed speed test state and results. Does not start a test.', annotations: { readOnlyHint: true }, execute: () => stateRef.current }, { name: 'run_connection_speed_test', description: 'Run a real speed test, updating the page. Uses up to 96 MB of payload plus overhead. Returns results on completion.', execute: start }];
    for (const tool of toolDefs) try { Promise.resolve(context.registerTool({ ...tool, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: input => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.'); return tool.execute(); } }, { signal: lifecycle.signal })).catch(() => {}); } catch { /* Optional enhancement. */ }
    return () => lifecycle.abort();
  }, [start]);
  const status = !connection.online ? 'offline' : busy ? 'testing' : connection.status;
  const statusText = { online: 'Connected', offline: 'Offline', checking: 'Checking connection', unreachable: 'Endpoint unreachable', testing: 'Testing connection' }[status];
  const statusDetail = { online: 'The test endpoint is reachable.', offline: 'Your browser reports no network connection.', checking: 'Checking the test endpoint…', unreachable: 'Your device is online, but the test endpoint did not respond.', testing: 'Connection checks pause during the speed test.' }[status];
  const phaseIndex = phases.indexOf(phase), measurement = phase === 'done' ? result.download : busy && phase !== 'latency' ? current : null;
  return <div className="app-shell"><header className="site-header"><a className="brand" href="./" aria-label="Pulse home"><span className="brand-mark"><Activity size={23} strokeWidth={2.8}/></span>pulse<span className="brand-period">.</span></a><div className="header-divider"/><span className="header-description">Internet check</span><div className={`connection-pill ${status}`} role="status"><span className="status-dot"/>{statusText}</div></header>
  <main className="mx-auto max-w-[1240px] px-5 md:px-9"><div className="page-title"><div><div className="eyebrow text-lime mb-3">A LITTLE CLARITY FOR YOUR CONNECTION</div><h1>How’s your internet?</h1><p>Check your connection. Find your speed.</p></div><span className="private-note"><ShieldCheck size={16}/>No account needed</span></div>
  <div className="workspace"><section className="test-panel" aria-labelledby="test-title"><div className="panel-top"><h2 id="test-title"><Radio size={17}/>Speed test</h2><span className="small-tag">LIVE MEASUREMENT</span></div><Gauge value={measurement} phase={phase} busy={busy}/><div className="test-controls"><button className={`test-button ${busy ? 'stop-button' : ''}`} onClick={busy ? stop : start} disabled={!busy && !connection.online}>{busy ? <><Square size={17}/>Stop test</> : <>{phase === 'idle' ? <Zap size={18} fill="currentColor"/> : <RotateCw size={18}/>} {phase === 'idle' ? 'Start speed test' : 'Run again'}<ArrowUpRight size={19}/></>}</button><p>{busy ? 'Keep this tab open for the best measurement.' : 'About 20 seconds · Up to 96 MB of test data'}</p></div><div className="phase-track" aria-label="Test stages">{phases.map((item, index) => <div className={phase === 'done' || busy && phaseIndex > index ? 'complete' : phase === item ? 'active' : ''} key={item}><span>{phase === 'done' || busy && phaseIndex > index ? <Check size={12}/> : `0${index + 1}`}</span>{item[0].toUpperCase() + item.slice(1)}</div>)}</div><div className="progress-rail" role="progressbar" aria-label="Speed test progress" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }}/></div></section>
  <div className="results-column"><div className="results-heading"><h2>Your results</h2><span>{phase === 'done' ? 'Just measured' : busy ? 'In progress' : ['error','stopped'].includes(phase) ? 'Partial results' : 'Awaiting test'}</span></div><div className="metric-grid"><Metric title="Download" icon={ArrowDown} value={result.download} unit="Mbps" detail="Receiving files & streaming" active={phase === 'download'} accent/><Metric title="Upload" icon={ArrowUp} value={result.upload} unit="Mbps" detail="Sending files & video calls" active={phase === 'upload'}/><Metric title="Latency" icon={Clock3} value={result.latency} unit="ms" detail="Response time · lower is better" active={phase === 'latency'}/><Metric title="Jitter" icon={Activity} value={result.jitter} unit="ms" detail="Delay variation · lower is better"/></div><div className={`connection-card ${['offline','unreachable'].includes(status) ? 'connection-warning' : ''}`}><span className="connection-icon">{status === 'offline' ? <WifiOff size={23}/> : <Wifi size={23}/>}</span><div className="min-w-0"><h3>{statusText}</h3><p>{statusDetail}</p></div><button className="icon-button" aria-label="Recheck connection" title="Recheck connection" disabled={busy || status === 'checking'} onClick={connection.check}><RotateCw size={17} className={status === 'checking' ? 'animate-spin' : ''}/></button></div>{error && <div className="error-message" role="alert">{error}</div>}{result.shortSample && phase === 'done' && <p className="sample-note">Data limit reached quickly. Short samples may underestimate very fast connections.</p>}</div></div>
  <section className="detail-panel"><ThroughputChart samples={samples} busy={busy}/><div className="connection-details"><h2>Connection details</h2><dl><div><dt><Globe2 size={15}/>Test network</dt><dd>Cloudflare</dd></div><div><dt><Wifi size={15}/>Connection type</dt><dd>{connection.network?.replaceAll('_',' ') || 'Not reported'}</dd></div><div><dt><Clock3 size={15}/>Last connection check</dt><dd>{connection.checked ? new Date(connection.checked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</dd></div><div><dt><ArrowDown size={15}/>Measured payload</dt><dd>{result.bytes ? `${(result.bytes / 1_000_000).toFixed(1)} MB` : '—'}</dd></div></dl></div></section>
  <GlobalReach/>
  <details className="how-it-works"><summary><CircleHelp size={17}/><span>What do these numbers mean?</span><span className="details-plus">+</span></summary><div className="explanation"><p><strong>Speed</strong> is measured using real downloads and uploads to Cloudflare. Results estimate this browser’s HTTP throughput, including request overhead; they are not a guarantee of your plan’s maximum speed.</p><p><strong>Latency</strong> is the median of six small HTTP round trips after a warm-up. <strong>Jitter</strong> measures the average difference between consecutive round trips. These are HTTP timings, not ICMP ping.</p><p>Close large downloads and keep this tab in the foreground. VPNs, Wi-Fi, server distance, and other devices can affect results. Tests use up to 96 MB of payload plus network overhead; stopping can reduce usage.</p><p>Connection checks run every 15 seconds while this page is visible, except during a speed test. A blocked or unreachable endpoint does not necessarily mean you are offline. Connection type is shown only when the browser provides it. Results stay in this page; Cloudflare receives your test traffic and IP address. <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noreferrer">Cloudflare privacy policy ↗</a></p></div></details><footer><span><Activity size={14}/>Small check. Clear picture.</span><span>Measured in your browser <span>·</span>Powered by real transfers</span></footer><span className="sr-only" aria-live="polite">{phaseLabels[phase]}{phase === 'done' ? `. Download ${number(result.download)} Mbps, upload ${number(result.upload)} Mbps, latency ${number(result.latency)} milliseconds.` : ''}</span></main></div>;
}
