import { useState, useMemo } from "react";

const FEATURES = [
  { id: "core", name: "Ask Documents", icon: "💬", price: 1200, required: true,
    desc: "Ask questions across your engineering documents and get answers with source citations. Runs fully on your own hardware." },
  { id: "email", name: "Email Ingestion", icon: "✉️", price: 400,
    desc: "Connect a mailbox and add vendor and internal correspondence straight into the knowledge base." },
  { id: "compliance", name: "Compliance Check", icon: "🔍", price: 700,
    desc: "Compare a specification against a vendor submittal and flag mismatches, such as a 1000 mAh requirement against a 700 mAh offer." },
  { id: "scraper", name: "Web Scraper", icon: "🌐", price: 350,
    desc: "Paste a URL and add the page's content to the knowledge base." },
  { id: "sandbox", name: "Security Sandbox", icon: "🛡️", price: 500,
    desc: "Scans every upload before it is processed. Blocks spoofed file types so the backend stays safe." },
];

const MODELS = [
  { id: "ollama-3b", name: "Local 3B", tag: "Ollama", price: 0, hw: "8 GB GPU", note: "Fast and light. Good for simple lookups." },
  { id: "ollama-7b", name: "Local 7B", tag: "Ollama", price: 150, hw: "16 GB GPU", note: "Balanced speed and answer quality." },
  { id: "ollama-14b", name: "Local 14B", tag: "Ollama", price: 300, hw: "24 GB GPU", note: "Best local quality for complex documents." },
  { id: "frontier", name: "Frontier model", tag: "Cloud API", price: 600, hw: "No GPU needed", note: "Highest accuracy. Document text leaves your network." },
];

const fmt = (n) => "$" + n.toLocaleString("en-US");

const CSS = `
.ag{--bg:#050505;--panel:#0d0d0d;--line:#222;--line2:#333;--text:#ececec;--mute:#8d8d8d;--acc:#4f46e5;--ok:#2ecc8f;
 min-height:100vh;background:var(--bg);color:var(--text);font-family:"Inter",system-ui,sans-serif;display:flex;gap:28px;padding:20px;box-sizing:border-box}
.ag *{box-sizing:border-box}
.ag button{font:inherit;color:inherit;cursor:pointer}
.ag button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.ag-side{width:255px;flex:none;border:1px solid var(--line);border-radius:28px;background:linear-gradient(180deg,#0f0f0f,#080808);padding:26px 18px;position:sticky;top:20px;height:calc(100vh - 40px)}
.ag-brand{display:flex;gap:10px;align-items:flex-start;margin-bottom:34px;padding-left:6px}
.ag-dot{width:9px;height:9px;border-radius:50%;background:var(--ok);margin-top:7px;box-shadow:0 0 8px var(--ok)}
.ag-brand b{font-size:17px;font-weight:500;display:block}
.ag-brand small{font-family:ui-monospace,monospace;font-size:9.5px;letter-spacing:.12em;color:var(--ok)}
.ag-nav a{display:block;padding:11px 16px;margin:2px 0;color:var(--mute);font-size:15px;text-decoration:none;border-left:2px solid transparent}
.ag-nav a:hover{color:var(--text)}
.ag-nav a.on{color:var(--text);border-left-color:var(--acc);background:linear-gradient(90deg,#4f46e51a,transparent)}
.ag-main{flex:1;min-width:0}
.ag-top{display:flex;justify-content:space-between;align-items:center;border:1px solid var(--line2);border-radius:999px;padding:14px 28px;background:#0a0a0a;margin-bottom:44px}
.ag-top span{font-size:15px}
.ag-top nav{display:flex;gap:22px;font-size:14px}
.ag-top nav i{font-style:normal;color:#cfcfcf}
.ag h1{font-size:34px;font-weight:500;margin:0 0 6px;letter-spacing:-.01em}
.ag-sub{font-weight:600;font-size:15px;margin:0 0 8px}
.ag-lead{color:var(--mute);font-size:15px;line-height:1.6;max-width:640px;margin:0 0 34px}
.ag-grid{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:28px;align-items:start}
.ag h2{font-size:18px;font-weight:500;margin:0 0 14px}
.ag-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-bottom:38px}
.ag-card{border:1px solid var(--line);border-radius:18px;background:var(--panel);padding:20px;display:flex;flex-direction:column;gap:10px;transition:border-color .2s,background .2s}
.ag-card.sel{border-color:var(--acc);background:#11102a}
.ag-card .hd{display:flex;justify-content:space-between;align-items:center}
.ag-card .ic{font-size:22px}
.ag-card h3{margin:0;font-size:16px;font-weight:500}
.ag-card p{margin:0;color:var(--mute);font-size:13.5px;line-height:1.55;flex:1}
.ag-card .ft{display:flex;justify-content:space-between;align-items:center;margin-top:6px}
.ag-price{font-size:17px}
.ag-price small{color:var(--mute);font-size:12px}
.ag-btn{border:1px solid var(--line2);background:#141414;border-radius:12px;padding:8px 16px;font-size:13.5px;transition:background .15s,border-color .15s}
.ag-btn:hover{background:#1c1c1c}
.ag-btn.add{background:var(--acc);border-color:var(--acc);color:#fff}
.ag-btn.add:hover{background:#4338ca}
.ag-btn[disabled]{opacity:.6;cursor:default}
.ag-badge{font-size:11.5px;color:var(--ok);border:1px solid #1d5a44;border-radius:999px;padding:3px 10px}
.ag-models{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin-bottom:20px}
.ag-model{text-align:left;border:1px solid var(--line);border-radius:18px;background:var(--panel);padding:18px;display:flex;flex-direction:column;gap:6px}
.ag-model:hover{border-color:var(--line2)}
.ag-model.sel{border-color:var(--acc);background:#11102a}
.ag-model .r{display:flex;justify-content:space-between;align-items:center}
.ag-model b{font-weight:500;font-size:16px}
.ag-model .tag{font-size:11.5px;color:var(--mute);border:1px solid var(--line2);border-radius:999px;padding:2px 9px}
.ag-model .hw{font-size:12.5px;color:#b9b6f5}
.ag-model span.n{color:var(--mute);font-size:13px;line-height:1.5}
.ag-warn{font-size:13px;color:#e8b86a;border:1px solid #5a4520;background:#1a140a;border-radius:12px;padding:10px 14px;margin:0 0 30px}
.ag-cart{position:sticky;top:20px;border:1px solid var(--line2);border-radius:22px;background:#0b0b0b;padding:22px}
.ag-cart h2{margin-bottom:4px}
.ag-cart .em{color:var(--mute);font-size:13px;margin:0 0 14px}
.ag-line{display:flex;justify-content:space-between;gap:10px;padding:11px 0;border-top:1px solid var(--line);font-size:14px}
.ag-line .rm{background:none;border:0;color:var(--mute);font-size:12.5px;padding:0;margin-top:3px;display:block;text-decoration:underline}
.ag-line .rm:hover{color:#ff7b7b}
.ag-total{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid var(--line2);padding-top:14px;margin-top:4px}
.ag-total b{font-size:26px;font-weight:500}
.ag-total small{color:var(--mute);font-size:12px}
.ag-go{width:100%;margin-top:16px;padding:13px;border-radius:14px;border:0;background:var(--acc);color:#fff;font-size:15px}
.ag-go:hover{background:#4338ca}
.ag-done{margin-top:16px;border:1px solid #1d5a44;background:#0a1a14;border-radius:14px;padding:14px;font-size:13.5px;line-height:1.5;color:#bfeedd}
.ag-done button{margin-top:8px;background:none;border:0;color:var(--mute);text-decoration:underline;padding:0;font-size:12.5px}
@media(max-width:1000px){.ag{flex-direction:column;padding:12px}.ag-side{display:none}.ag-grid{grid-template-columns:1fr}.ag-cart{position:static}.ag-top nav{display:none}}
`;

export default function AegisFeatureStore() {
  const [picked, setPicked] = useState(["core"]);
  const [model, setModel] = useState("ollama-7b");
  const [ordered, setOrdered] = useState(false);

  const toggle = (id) => {
    setOrdered(false);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  const m = MODELS.find((x) => x.id === model);
  const lines = useMemo(() => FEATURES.filter((f) => picked.includes(f.id)), [picked]);
  const total = lines.reduce((s, f) => s + f.price, 0) + m.price;
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="ag">
      <style>{CSS}</style>

      <aside className="ag-side">
        <div className="ag-brand">
          <span className="ag-dot" />
          <div><b>AEGIS AI</b><small>ENGINEERING INTELLIGENCE</small></div>
        </div>
        <nav className="ag-nav">
          <a className="on" href="#features" onClick={(e) => { e.preventDefault(); go("features"); }}>Features</a>
          <a href="#models" onClick={(e) => { e.preventDefault(); go("models"); }}>AI Model</a>
          <a href="#cart" onClick={(e) => { e.preventDefault(); go("cart"); }}>Your Plan</a>
        </nav>
      </aside>

      <main className="ag-main">
        <header className="ag-top">
          <span>AEGIS AI</span>
          <nav><i>Features</i><i>Pricing</i><i>Deployment</i><i>Contact</i></nav>
        </header>

        <h1>Build your AEGIS AI plan</h1>
        <p className="ag-sub">Pick only the features your team needs</p>
        <p className="ag-lead">
          Every plan starts with Ask Documents. Add email, compliance checks, web scraping, and upload
          security as you need them, then choose the AI model that runs it.
        </p>

        <div className="ag-grid">
          <div>
            <h2 id="features">Features</h2>
            <div className="ag-cards">
              {FEATURES.map((f) => {
                const on = picked.includes(f.id);
                return (
                  <div key={f.id} className={"ag-card" + (on ? " sel" : "")}>
                    <div className="hd">
                      <span className="ic">{f.icon}</span>
                      {f.required && <span className="ag-badge">Included</span>}
                    </div>
                    <h3>{f.name}</h3>
                    <p>{f.desc}</p>
                    <div className="ft">
                      <span className="ag-price">{fmt(f.price)} <small>one-time</small></span>
                      {f.required ? (
                        <button className="ag-btn" disabled>In cart</button>
                      ) : (
                        <button className={"ag-btn" + (on ? "" : " add")} onClick={() => toggle(f.id)}>
                          {on ? "Remove" : "Add to cart"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <h2 id="models">AI model</h2>
            <div className="ag-models" role="radiogroup" aria-label="AI model">
              {MODELS.map((x) => (
                <button key={x.id} role="radio" aria-checked={model === x.id}
                  className={"ag-model" + (model === x.id ? " sel" : "")}
                  onClick={() => { setModel(x.id); setOrdered(false); }}>
                  <div className="r"><b>{x.name}</b><span className="tag">{x.tag}</span></div>
                  <span className="hw">{x.hw}</span>
                  <span className="n">{x.note}</span>
                  <span className="ag-price">{x.price ? fmt(x.price) : "Free"}</span>
                </button>
              ))}
            </div>
            {model === "frontier" && (
              <p className="ag-warn">
                Frontier models run in the cloud, so document text is sent outside your network.
                Choose a local model if your data must stay on-premises.
              </p>
            )}
          </div>

          <aside className="ag-cart" id="cart">
            <h2>Your plan</h2>
            <p className="em">{lines.length} of {FEATURES.length} features selected</p>
            {lines.map((f) => (
              <div className="ag-line" key={f.id}>
                <div>
                  {f.name}
                  {!f.required && <button className="rm" onClick={() => toggle(f.id)}>Remove</button>}
                </div>
                <span>{fmt(f.price)}</span>
              </div>
            ))}
            <div className="ag-line">
              <div>Model: {m.name}<br /><small style={{ color: "var(--mute)" }}>{m.hw}</small></div>
              <span>{m.price ? fmt(m.price) : "Free"}</span>
            </div>
            <div className="ag-total"><small>Total</small><b>{fmt(total)}</b></div>

            {ordered ? (
              <div className="ag-done">
                Quote request sent for {lines.length} features with the {m.name} model.
                <br /><button onClick={() => setOrdered(false)}>Edit plan</button>
              </div>
            ) : (
              <button className="ag-go" onClick={() => setOrdered(true)}>Request quote</button>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}