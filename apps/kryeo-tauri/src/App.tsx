import { invoke } from '@tauri-apps/api/core';
import {
  ArrowUpRight, Boxes, Check, ChevronRight, CircleHelp, FolderOutput,
  Layers3, Play, ScanSearch, Settings2, Sparkles, Workflow,
} from 'lucide-react';
import { useEffect, useState } from 'react';

type GatewayStatus = { reachable: boolean; endpoint: string; message: string };

const nav = [
  ['Pipeline', Workflow], ['Component scan', ScanSearch], ['Library', Boxes],
  ['Exports', FolderOutput], ['Settings', Settings2],
] as const;

const stages = [
  ['01', 'Read the document', 'Affinity hierarchy and visual exports'],
  ['02', 'Recognise families', 'Exact duplicates and composed boundaries'],
  ['03', 'Make one decision', 'Name, type, role, grouping, and confidence'],
  ['04', 'Review exceptions', 'Only the genuinely uncertain work'],
] as const;

export function App() {
  const [active, setActive] = useState('Pipeline');
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);

  useEffect(() => {
    invoke<GatewayStatus>('gateway_status').then(setGateway).catch(() => {
      setGateway({ reachable: false, endpoint: 'http://127.0.0.1:8787', message: 'Native gateway check failed.' });
    });
  }, []);

  return (
    <main className="shell">
      <aside className="rail" aria-label="Main navigation">
        <div className="brand"><span className="brand-mark">K</span><span>Kryeo</span></div>
        <div className="project-switcher"><span className="eyebrow">Active project</span><strong>Untitled workspace</strong><ChevronRight size={15} /></div>
        <nav>{nav.map(([label, Icon]) => <button key={label} className={active === label ? 'nav-item is-active' : 'nav-item'} onClick={() => setActive(label)}><Icon size={18} /><span>{label}</span></button>)}</nav>
        <div className="rail-foot"><button className="nav-item"><CircleHelp size={18} /><span>Help & feedback</span></button><small>Desktop next · preview</small></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">{active}</span><h1>From document to ready-to-use assets.</h1></div>
          <div className={gateway?.reachable ? 'gateway is-online' : 'gateway'}><i />{gateway ? gateway.message : 'Checking local services…'}</div>
        </header>

        <section className="hero">
          <div className="hero-copy"><span className="kicker"><Sparkles size={15} /> A calmer scan workflow</span><h2>See the document.<br /><em>Trust the decisions.</em></h2><p>Kryeo reads the actual hierarchy, gives each visual one complete decision, then leaves only real exceptions for review.</p><button className="primary-action"><Play size={16} fill="currentColor" /> Start component scan</button></div>
          <div className="preview-card" aria-label="Component scan preview"><div className="preview-grid"><span /><span /><span /><span /><span /></div><div className="preview-caption"><div><span className="eyebrow">Next up</span><strong>Choose an Affinity document</strong></div><ArrowUpRight size={18} /></div></div>
        </section>

        <section className="dashboard-grid">
          <div className="section-heading"><div><span className="eyebrow">How this works</span><h3>One clear path, no hidden work.</h3></div><button className="quiet-link">View scan architecture <ArrowUpRight size={15} /></button></div>
          <div className="stage-grid">{stages.map(([number, title, detail]) => <article className="stage" key={number}><span>{number}</span><h4>{title}</h4><p>{detail}</p></article>)}</div>
        </section>

        <section className="status-panel">
          <div className="status-icon"><Layers3 size={22} /></div><div><span className="eyebrow">Ready when you are</span><h3>No document is connected</h3><p>Open Affinity, select the document you want to organise, then start a scan.</p></div><button className="outline-action">Check connection <Check size={16} /></button>
        </section>
      </section>
    </main>
  );
}
