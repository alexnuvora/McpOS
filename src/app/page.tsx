"use client";
import { Activity, Bot, Boxes, Braces, CheckCircle2, ChevronDown, CircleDot, Cloud, Command, GitBranch, Github, LayoutDashboard, Monitor, MousePointer2, Plus, Search, Settings2, ShieldCheck, TerminalSquare, Workflow } from "lucide-react";
import GitHubRepositoryPicker from "@/components/github-repository-picker";

const capabilities = [
  ["Desktop companion","Pair a Windows computer and manage active sessions.",Monitor,"Planned"],
  ["Screen understanding","Let AI inspect your screen and accessible app controls.",Monitor,"Planned"],
  ["Computer control","Permissioned mouse, keyboard and application actions.",MousePointer2,"Planned"],
  ["Browser automation","Operate an isolated, approved browser profile.",Search,"Planned"],
  ["MCP gateway","Securely connect AI clients to paired desktop devices.",Braces,"Foundation"],
  ["Permissions & audit","Approve actions, revoke access and review activity.",ShieldCheck,"Planned"]
] as const;

export default function Home() {
 return <div className="workspace-grid">
  <aside className="sidebar flex flex-col p-4">
   <div className="mb-8 flex items-center gap-3 px-2 pt-1"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300"><Command size={19}/></div><div><div className="text-sm font-semibold">McpOS</div><div className="text-[11px] text-slate-500">AI desktop agent platform</div></div><ChevronDown className="ml-auto text-slate-500" size={15}/></div>
   <div className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Workspace</div>
   <nav className="space-y-1"><div className="nav-item active"><LayoutDashboard size={16}/>Overview</div><div className="nav-item"><Monitor size={16}/>Devices<span className="ml-auto pill">0</span></div><div className="nav-item"><Activity size={16}/>Sessions</div><div className="nav-item"><Braces size={16}/>AI clients</div></nav>
   <div className="mb-3 mt-8 px-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Platform</div>
   <nav className="space-y-1"><div className="nav-item"><ShieldCheck size={16}/>Permissions</div><div className="nav-item"><Activity size={16}/>Activity & logs</div><div className="nav-item"><Settings2 size={16}/>Settings</div></nav>
   <div className="panel-soft mt-auto p-3"><div className="mb-2 flex items-center gap-2 text-xs font-medium"><ShieldCheck size={14} className="text-emerald-400"/>Desktop access not connected</div><p className="text-[11px] leading-5 text-slate-500">Desktop access is not connected yet. Pairing, screen capture and control are planned; no remote desktop actions are currently enabled.</p></div>
   <div className="mt-4 px-2 text-xs text-slate-500">Private workspace · v0.1</div>
  </aside>
  <main className="min-w-0">
   <header className="flex h-[65px] items-center justify-between border-b border-[#252d3a] px-5 sm:px-8"><div className="text-xs text-slate-500">Workspace <span className="mx-2">/</span><span className="text-slate-200">Overview</span></div><div className="flex items-center gap-2 text-xs text-amber-300"><span className="h-2 w-2 rounded-full bg-amber-400"/>Setup required</div></header>
   <div className="mx-auto max-w-[1400px] p-5 sm:p-8">
    <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 flex items-center gap-2 text-xs text-indigo-300"><CircleDot size={13}/>YOUR AI DESKTOP CONTROL CENTRE</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your AI, at your desktop.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Connect AI to your Windows desktop, apps, browser and approved files — with you in control.</p></div><button disabled className="flex cursor-not-allowed items-center gap-2 rounded-lg border border-[#30394a] bg-[#171e2a] px-4 py-2.5 text-sm text-slate-500"><Plus size={15}/>Add project</button></div>
    
    <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Paired devices","0","Install McpOS Desktop",Monitor],["Active sessions","0","No desktop sessions running",Activity],["AI clients","0","No MCP client connected",Braces],["Enabled capabilities","0","All permissions disabled",ShieldCheck]].map(([name,value,note,Icon])=>{const I=Icon as typeof Github;return <div className="panel p-4" key={String(name)}><div className="flex items-center justify-between text-xs text-slate-400"><span>{String(name)}</span><I size={16}/></div><div className="mt-3 text-2xl font-semibold">{String(value)}</div><div className="mt-1 text-[11px] text-slate-500">{String(note)}</div></div>})}</div>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,.8fr)]">
     <section><div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Getting started</div><div className="panel divide-y divide-[#252d3a]">{[["Install the Windows companion","Pair this computer with your McpOS account.",Monitor],["Choose desktop permissions","Start with screen observation; enable input, browser and file access separately.",ShieldCheck],["Connect an AI client","Pair an MCP-compatible AI client with your secure McpOS gateway.",Bot]].map(([title,description,Icon],i)=>{const I=Icon as typeof Github;return <div key={String(title)} className="flex gap-4 p-4 sm:p-5"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1a2230] text-slate-300"><I size={17}/></div><div><div className="text-sm font-medium">{i+1}. {String(title)}</div><p className="mt-1 text-xs leading-5 text-slate-500">{String(description)}</p><div className="mt-3 flex items-center gap-2 text-[11px] text-amber-300"><CircleDot size={11}/>Not configured</div></div></div>})}</div></section>
     <section><div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Platform status</div><div className="panel p-4"><div className="mb-4 flex items-center justify-between"><div className="text-sm font-medium">Core services</div><span className="pill">Desktop agent planned</span></div>{["Web workspace","MCP endpoint","Desktop companion","MCP device relay","Computer-use tools"].map((item,i)=><div key={item} className="flex items-center justify-between border-t border-[#252d3a] py-3 text-xs"><span className="text-slate-400">{item}</span><span className={i<2?"flex items-center gap-1.5 text-emerald-300":"flex items-center gap-1.5 text-slate-500"}>{i<2?<CheckCircle2 size={13}/>:<CircleDot size={13}/>} {i<2?"Foundation added":"Not configured"}</span></div>)}</div><div className="panel mt-4 p-4"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><ShieldCheck size={15} className="text-emerald-300"/>Safety by default</div><p className="text-xs leading-5 text-slate-500">Desktop access will be opt-in, visible and permission-scoped. Consequential actions will require confirmation and every action will be auditable.</p></div></section>
    </div>
    <section className="mt-8"><div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Workspace capabilities</div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{capabilities.map(([title,description,Icon,state])=><div className="panel p-4" key={title}><div className="mb-3 flex items-center justify-between"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a2230] text-indigo-300"><Icon size={16}/></div><span className="pill">{state}</span></div><div className="text-sm font-medium">{title}</div><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>)}</div></section>
    <footer className="mt-10 flex flex-col justify-between gap-2 border-t border-[#252d3a] pt-5 text-[11px] text-slate-600 sm:flex-row"><span>McpOS · AI Desktop Agent</span><span>Foundation build · Production integrations not yet enabled</span></footer>
   </div>
  </main>
 </div>;
}
