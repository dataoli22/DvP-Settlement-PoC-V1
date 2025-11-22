import React, { useEffect, useMemo, useRef, useState } from "react";

// Minimal EIP-1193 + ethers-lite helpers without external deps
// We'll rely on window.ethereum and the native Browser provider injected by wallets.
// For formatting, we use Intl.NumberFormat.

function fmtUnits(value, decimals = 18) {
  try {
    const bn = BigInt(value.toString());
    const sign = bn < 0n ? "-" : "";
    const v = bn < 0n ? -bn : bn;
    const int = v / BigInt(10) ** BigInt(decimals);
    const frac = v % (BigInt(10) ** BigInt(decimals));
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return sign + int.toString() + (fracStr ? "." + fracStr : "");
  } catch {
    return value?.toString?.() ?? String(value);
  }
}

async function request(method, params = []) {
  if (!window.ethereum) throw new Error("No wallet found. Install MetaMask or a compatible wallet.");
  return await window.ethereum.request({ method, params });
}

function toHex(value) {
  return "0x" + BigInt(value).toString(16);
}

async function getProvider() {
  if (!window.ethereum) throw new Error("No wallet found.");
  return window.ethereum;
}

function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);

  useEffect(() => {
    (async () => {
      if (!window.ethereum) return;
      const [acc] = (await request("eth_accounts")) || [];
      const cid = await request("eth_chainId");
      if (acc) setAccount(acc);
      if (cid) setChainId(cid);
    })();

    const onAccountsChanged = (accs) => setAccount(accs?.[0] || null);
    const onChainChanged = (cid) => setChainId(cid);

    window.ethereum?.on?.("accountsChanged", onAccountsChanged);
    window.ethereum?.on?.("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  const connect = async () => {
    const [acc] = await request("eth_requestAccounts");
    setAccount(acc);
    const cid = await request("eth_chainId");
    setChainId(cid);
  };

  return { account, chainId, connect };
}

// Minimal ABI encoder for simple types. For complex ABIs users can paste full JSON and we call via eth_call / eth_sendTransaction with data built by a tiny encoder using ethers-like ABI if present.
// To keep this file dependency-light, we'll accept the ABI JSON and precompute function selectors and encode via browser's TextEncoder + utility. We'll support common types: address, uint256, bool, string, bytes.

// Lightweight encoder/decoder using ethers.js if present on window (many wallets inject it). If not, we fall back to dynamic import from CDN-less path; since we can't import, we implement extremely tiny support for common flows via public RPC method "eth_call" with pre-encoded data provided by user if needed.

// To keep UX smooth, we use a pragmatic approach: parse ABI JSON to list functions; for calls we build payload via a best-effort encoder for address/uint256/bool/string.

const keccak256 = async (dataHex) => {
  const bytes = hexToBytes(dataHex);
  const digest = await crypto.subtle.digest("SHA-256", bytes); // Not keccak, but we approximate selector via a tiny keccak function below.
  return bytesToHex(new Uint8Array(digest));
};

// Real keccak function (tiny) using js-sha3 if available on window; otherwise use a small implementation here.
import { keccak_256 } from "js-sha3";

function bytesToHex(bytes) {
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function pad32(hex) {
  const h = hex.replace(/^0x/, "");
  return "0x" + h.padStart(64, "0");
}

function encodeUint256(v) {
  const hex = BigInt(v).toString(16);
  return pad32("0x" + hex);
}

function encodeAddress(v) {
  return pad32(v);
}

function encodeBool(v) {
  return pad32("0x" + (v ? "1" : "0"));
}

function encodeBytes(vHex) {
  // Dynamic type: place length then data; here we only support fixed 32-byte inline for simplicity in quick calls.
  const h = vHex.replace(/^0x/, "");
  const padded = h.padEnd(Math.ceil(h.length / 64) * 64, "0");
  return pad32("0x" + (h.length / 2).toString(16)) + "" + "0x" + padded; // simplistic
}

function encodeString(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const hex = bytesToHex(bytes);
  return encodeBytes(hex);
}

function encodeArgs(inputs, values) {
  // For now handle address, uint256, bool, string
  const encoded = [];
  for (let i = 0; i < inputs.length; i++) {
    const t = inputs[i].type;
    const v = values[i];
    if (t === "address") encoded.push(encodeAddress(v));
    else if (t.startsWith("uint")) encoded.push(encodeUint256(v));
    else if (t === "bool") encoded.push(encodeBool(v === true || v === "true"));
    else if (t === "string") {
      // dynamic types require offsets; keep the quick path: we won't generally support dynamic in write here; for read, prefer eth_call via libraries.
      throw new Error("String args not supported in quick encoder. Use Read tab with freeform data or ensure your functions use address/uint/bool.");
    } else {
      throw new Error(`Type ${t} not supported in quick encoder.`);
    }
  }
  return encoded.join("").replace(/0x0x/g, "0x");
}

function selector(signature) {
  // keccak256(signature)[0..4]
  const hash = keccak_256(signature);
  return "0x" + hash.slice(0, 8);
}

function parseAbi(abiText) {
  try {
    const abi = JSON.parse(abiText);
    if (!Array.isArray(abi)) throw new Error("ABI must be a JSON array");
    return abi.filter((x) => x.type === "function");
  } catch (e) {
    return [];
  }
}

async function ethCall(to, data, from) {
  const res = await request("eth_call", [{ to, data, from }]);
  return res;
}

async function ethSend(to, data, value = "0x0") {
  const txHash = await request("eth_sendTransaction", [{ to, data, value }]);
  return txHash;
}

function Card({ title, children, actions }) {
  return (
    <div className="rounded-2xl border border-gray-200 shadow-sm p-5 bg-white">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        {actions}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export default function SecurityTokenStakeholderUI() {
  const { account, chainId, connect } = useWallet();

  const [tokenAddress, setTokenAddress] = useState("");
  const [complianceAddress, setComplianceAddress] = useState("");
  const [abiText, setAbiText] = useState("");
  const [complianceAbiText, setComplianceAbiText] = useState("");
  const [log, setLog] = useState([]);
  const [readResult, setReadResult] = useState("");
  const [busy, setBusy] = useState(false);

  const tokenFns = useMemo(() => parseAbi(abiText), [abiText]);
  const compFns = useMemo(() => parseAbi(complianceAbiText), [complianceAbiText]);

  function appendLog(entry) {
    setLog((prev) => [{ ts: new Date().toLocaleString(), ...entry }, ...prev].slice(0, 150));
  }

  const quickReads = [
    { label: "name()", sig: "name()", selector: selector("name()") },
    { label: "symbol()", sig: "symbol()", selector: selector("symbol()") },
    { label: "decimals()", sig: "decimals()", selector: selector("decimals()") },
    { label: "totalSupply()", sig: "totalSupply()", selector: selector("totalSupply()") },
    { label: "paused()", sig: "paused()", selector: selector("paused()") },
  ];

  async function doQuickRead(sig) {
    try {
      if (!tokenAddress) throw new Error("Set token address");
      const data = selector(sig);
      const out = await ethCall(tokenAddress, data, account || undefined);
      setReadResult(out);
      appendLog({ type: "read", msg: `${sig} -> ${out}` });
    } catch (e) {
      setReadResult("Error: " + e.message);
      appendLog({ type: "error", msg: e.message });
    }
  }

  // Dynamic function caller (write) for simple address/uint/bool args
  const [fnName, setFnName] = useState("");
  const [fnArgs, setFnArgs] = useState("");

  async function callWrite() {
    try {
      if (!account) await connect();
      if (!tokenAddress) throw new Error("Set token address");
      if (!fnName) throw new Error("Function name required");
      const fn = tokenFns.find((f) => `${f.name}(${f.inputs.map((i) => i.type).join(',')})` === fnName || f.name === fnName);
      if (!fn) throw new Error("Function not in ABI");
      const sig = `${fn.name}(${fn.inputs.map((i) => i.type).join(',')})`;
      const sel = selector(sig);
      const args = fnArgs.trim() ? fnArgs.split(",").map((s) => s.trim()) : [];
      const data = sel + encodeArgs(fn.inputs, args).replace(/^0x/, "");
      setBusy(true);
      const tx = await ethSend(tokenAddress, data);
      appendLog({ type: "tx", msg: `${fn.name} sent: ${tx}` });
      setBusy(false);
    } catch (e) {
      setBusy(false);
      appendLog({ type: "error", msg: e.message });
    }
  }

  // Helper quick actions if ABI exposes them
  const hasFn = (name) => tokenFns.some((f) => f.name === name);

  async function quickAction(name, args = []) {
    try {
      if (!account) await connect();
      const fn = tokenFns.find((f) => f.name === name);
      if (!fn) throw new Error(`${name} not in ABI`);
      const sig = `${fn.name}(${fn.inputs.map((i) => i.type).join(',')})`;
      const data = selector(sig) + encodeArgs(fn.inputs, args).replace(/^0x/, "");
      setBusy(true);
      const tx = await ethSend(tokenAddress, data);
      appendLog({ type: "tx", msg: `${name} -> ${tx}` });
      setBusy(false);
    } catch (e) {
      setBusy(false);
      appendLog({ type: "error", msg: e.message });
    }
  }

  function FunctionList({ abi, title, onSelect }) {
    const reads = abi.filter((f) => ["view", "pure"].includes(f.stateMutability));
    const writes = abi.filter((f) => !["view", "pure"].includes(f.stateMutability));
    return (
      <div className="grid md:grid-cols-2 gap-4">
        <Card title={`${title} • Read`}>
          <div className="max-h-60 overflow-auto text-sm">
            {reads.map((f) => (
              <div key={f.name + f.inputs.length} className="py-1 border-b last:border-none">
                <button onClick={() => onSelect && onSelect(f)} className="hover:underline">
                  {f.name}({f.inputs.map((i) => i.type).join(", ")}) → {f.outputs?.map((o) => o.type).join(", ")}
                </button>
              </div>
            ))}
            {!reads.length && <div className="text-gray-500">No read functions.</div>}
          </div>
        </Card>
        <Card title={`${title} • Write`}>
          <div className="max-h-60 overflow-auto text-sm">
            {writes.map((f) => (
              <div key={f.name + f.inputs.length} className="py-1 border-b last:border-none">
                <span>{f.name}({f.inputs.map((i) => i.type).join(", ")})</span>
              </div>
            ))}
            {!writes.length && <div className="text-gray-500">No write functions.</div>}
          </div>
        </Card>
      </div>
    );
  }

  const [selectedRead, setSelectedRead] = useState(null);
  const [readArgs, setReadArgs] = useState("");

  async function doSelectedRead() {
    if (!selectedRead) return;
    try {
      if (!tokenAddress) throw new Error("Set token address");
      const sig = `${selectedRead.name}(${selectedRead.inputs.map((i) => i.type).join(',')})`;
      const sel = selector(sig);
      const args = readArgs.trim() ? readArgs.split(",").map((s) => s.trim()) : [];
      const data = sel + (selectedRead.inputs.length ? encodeArgs(selectedRead.inputs, args).replace(/^0x/, "") : "");
      const out = await ethCall(tokenAddress, data, account || undefined);
      setReadResult(out);
      appendLog({ type: "read", msg: `${sig} -> ${out}` });
    } catch (e) {
      setReadResult("Error: " + e.message);
      appendLog({ type: "error", msg: e.message });
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Security Token PoC – Stakeholder UI</h1>
            <p className="text-sm text-gray-600">Demo dApp to exercise key flows: metadata, compliance, whitelist/KYC, mint/burn, transfer, pause, and event logs. Paste your ABIs and addresses to go live on your testnet.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 hidden md:inline">{chainId ? `Chain: ${parseInt(chainId)} ` : "Not connected"}</span>
            {account ? (
              <span className="text-sm font-mono bg-gray-200 px-3 py-1 rounded-full">{account.slice(0, 6)}…{account.slice(-4)}</span>
            ) : (
              <button onClick={connect} className="px-4 py-2 rounded-2xl bg-black text-white shadow hover:opacity-90">Connect Wallet</button>
            )}
          </div>
        </header>

        {/* Setup */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card title="1) Token Contract Setup">
            <label className="text-sm">Token Contract Address</label>
            <input value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} placeholder="0x..." className="w-full border rounded-xl px-3 py-2" />
            <label className="text-sm">Token ABI (JSON)</label>
            <textarea value={abiText} onChange={(e) => setAbiText(e.target.value)} placeholder="Paste SecurityToken ABI JSON here" rows={8} className="w-full border rounded-xl px-3 py-2 font-mono text-xs" />
            <div className="text-xs text-gray-500">Tip: from Foundry build, take <code>out/SecurityToken.sol/SecurityToken.json</code> → copy the <code>abi</code> array.</div>
          </Card>
          <Card title="2) Compliance/KYC Setup (Optional)">
            <label className="text-sm">Compliance Contract Address</label>
            <input value={complianceAddress} onChange={(e) => setComplianceAddress(e.target.value)} placeholder="0x..." className="w-full border rounded-xl px-3 py-2" />
            <label className="text-sm">Compliance ABI (JSON)</label>
            <textarea value={complianceAbiText} onChange={(e) => setComplianceAbiText(e.target.value)} placeholder="Paste Compliance ABI JSON here" rows={8} className="w-full border rounded-xl px-3 py-2 font-mono text-xs" />
            <div className="text-xs text-gray-500">If your flow requires whitelist/blacklist/region locks, paste those functions here to drive the UI.</div>
          </Card>
        </div>

        {/* Quick metadata */}
        <Card title="Token Snapshot">
          <div className="flex flex-wrap gap-3">
            {quickReads.map((q) => (
              <button key={q.sig} onClick={() => doQuickRead(q.sig)} className="px-3 py-2 text-sm rounded-xl border hover:bg-gray-50">{q.label}</button>
            ))}
          </div>
          <div className="text-sm font-mono bg-gray-100 rounded-xl p-3 break-all">{readResult || "Output will appear here."}</div>
        </Card>

        {/* ABI explorer */}
        <Card title="ABI Explorer (Click a read function, pass args, view raw hex output)">
          <FunctionList abi={tokenFns} title="Token" onSelect={(f) => setSelectedRead(f)} />
          {selectedRead && (
            <div className="mt-4 grid md:grid-cols-3 gap-3 items-end">
              <div className="md:col-span-2">
                <div className="text-sm mb-1 font-medium">{selectedRead.name}({selectedRead.inputs.map((i) => i.type).join(", ")})</div>
                <input value={readArgs} onChange={(e) => setReadArgs(e.target.value)} placeholder={selectedRead.inputs.length ? `Comma-separated args for: ${selectedRead.inputs.map((i)=>i.type).join(', ')}` : "No args"} className="w-full border rounded-xl px-3 py-2 font-mono text-xs" />
              </div>
              <button onClick={doSelectedRead} className="px-4 py-2 rounded-2xl bg-black text-white shadow hover:opacity-90">Call</button>
            </div>
          )}
        </Card>

        {/* Admin actions */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card title="Admin: Common Actions" actions={busy && <span className="text-xs text-gray-500">sending…</span>}>
            <div className="grid sm:grid-cols-2 gap-3">
              {hasFn("pause") && (
                <button onClick={() => quickAction("pause")} className="px-3 py-2 rounded-xl border hover:bg-gray-50">pause()</button>
              )}
              {hasFn("unpause") && (
                <button onClick={() => quickAction("unpause")} className="px-3 py-2 rounded-xl border hover:bg-gray-50">unpause()</button>
              )}
              {hasFn("mint") && (
                <QuickMint onMint={(to, amount) => quickAction("mint", [to, amount])} />
              )}
              {hasFn("burn") && (
                <QuickBurn onBurn={(amount) => quickAction("burn", [amount])} />
              )}
            </div>
            {!hasFn("pause") && !hasFn("unpause") && !hasFn("mint") && !hasFn("burn") && (
              <div className="text-sm text-gray-600">No common admin functions detected in ABI. Use the "Write Any Function" panel below.</div>
            )}
          </Card>

          <Card title="Compliance / Whitelisting">
            <div className="text-sm text-gray-600">If your Compliance ABI exposes functions like <code>whitelist(address,bool)</code> or <code>setKYC(address,bool)</code>, they will appear in the ABI list above. For a quick demo, you can also send arbitrary writes below.</div>
          </Card>
        </div>

        {/* Generic writer */}
        <Card title="Write Any Function (from Token ABI)">
          <div className="grid md:grid-cols-3 gap-3 items-end">
            <input value={fnName} onChange={(e) => setFnName(e.target.value)} placeholder="Function name or full signature, e.g. transfer(address,uint256)" className="w-full border rounded-xl px-3 py-2 font-mono text-xs" />
            <input value={fnArgs} onChange={(e) => setFnArgs(e.target.value)} placeholder="Comma-separated args (address/uint/bool only here)" className="w-full border rounded-xl px-3 py-2 font-mono text-xs" />
            <button disabled={busy} onClick={callWrite} className="px-4 py-2 rounded-2xl bg-black text-white shadow hover:opacity-90 disabled:opacity-50">Send Transaction</button>
          </div>
          <div className="text-xs text-gray-500">Note: This quick sender supports <strong>address</strong>, <strong>uint*</strong>, and <strong>bool</strong> arguments. For string/bytes arrays, prefer dedicated UI or extend encoder.</div>
        </Card>

        {/* Activity log */}
        <Card title="Activity & Logs (Most recent first)">
          <div className="max-h-72 overflow-auto text-sm font-mono bg-gray-50 rounded-xl p-3 space-y-2">
            {!log.length && <div className="text-gray-500">No activity yet.</div>}
            {log.map((l, idx) => (
              <div key={idx} className="border-b last:border-none pb-2">
                <div className="text-gray-500">{l.ts} • {l.type}</div>
                <div className="break-all">{l.msg}</div>
              </div>
            ))}
          </div>
        </Card>

        <footer className="text-xs text-gray-500 text-center pb-10">
          Built for your End‑to‑End Security Token PoC. Paste ABIs & addresses, connect wallet, and demo live.
        </footer>
      </div>
    </div>
  );
}

function QuickMint({ onMint }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <div className="border rounded-xl p-3 space-y-2">
      <div className="font-medium">mint(to, amount)</div>
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Recipient 0x..." className="w-full border rounded-xl px-3 py-2 text-sm" />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (wei)" className="w-full border rounded-xl px-3 py-2 text-sm" />
      <button onClick={() => onMint(to, amount)} className="w-full px-3 py-2 rounded-xl border hover:bg-gray-50">Send</button>
    </div>
  );
}

function QuickBurn({ onBurn }) {
  const [amount, setAmount] = useState("");
  return (
    <div className="border rounded-xl p-3 space-y-2">
      <div className="font-medium">burn(amount)</div>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (wei)" className="w-full border rounded-xl px-3 py-2 text-sm" />
      <button onClick={() => onBurn(amount)} className="w-full px-3 py-2 rounded-xl border hover:bg-gray-50">Send</button>
    </div>
  );
}
