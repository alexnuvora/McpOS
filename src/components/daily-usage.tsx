"use client";
import { useEffect, useState } from "react";
type Activity = { used: number; date: string; resetAt: string };
export default function DailyUsage() {
  const [activity,setActivity] = useState<Activity|null>(null);
  const [error,setError] = useState(false);
  useEffect(()=>{
    let active=true;
    let busy=false;
    const refresh=async()=>{
      if(busy)return;
      busy=true;
      try {
        const response=await fetch("/api/usage",{cache:"no-store"});
        if(!response.ok)throw new Error("Unavailable");
        const data=await response.json();
        if(!Number.isSafeInteger(data.used)||data.used<0)throw new Error("Invalid count");
        if(active){setActivity(data);setError(false);}
      }catch{if(active)setError(true);}
      finally{busy=false;}
    };
    void refresh();
    const timer=window.setInterval(()=>void refresh(),30000);
    window.addEventListener("focus",refresh);
    return ()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[]);
  return <section className="rounded-xl border border-[#30394a] bg-[#101722] p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-100">Today&apos;s desktop command activity</h2><span className="text-xs text-slate-400">Updates every 30s</span></div>
    <p className="mt-3 text-3xl font-semibold text-slate-100">{activity ? activity.used.toLocaleString("en-GB") : "—"}</p>
    <p className="mt-2 text-xs text-slate-400">Accepted desktop commands, including failed or denied actions after queuing. Resets at midnight UTC. Activity is separate from the enforced subscription allowance.</p>
    {error && <p role="status" className="mt-2 text-xs text-amber-300">{activity ? "Last known activity; refresh unavailable." : "Daily activity is temporarily unavailable."}</p>}
  </section>;
}
