"use client";

import { useEffect, useState } from "react";
import { Dashboard } from "@/components/Dashboard";
import { Markets } from "@/components/Markets";
import { type MarketTab } from "@/lib/markets";

function readPool() {
  if (typeof window === "undefined") return { id: null as string | null, tab: "lend" as MarketTab };
  const q = new URLSearchParams(window.location.search);
  const tab = q.get("tab");
  return {
    id: q.get("pool"),
    tab:
      tab === "borrow" || tab === "stability" || tab === "details"
        ? tab
        : ("lend" as MarketTab),
  };
}

export default function AppPage() {
  const [pool, setPool] = useState<string | null>(null);
  const [tab, setTab] = useState<MarketTab>("lend");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const next = readPool();
    setPool(next.id);
    setTab(next.tab);
    setReady(true);
    function onPop() {
      const cur = readPool();
      setPool(cur.id);
      setTab(cur.tab);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function open(id: string, nextTab: MarketTab = "lend") {
    const url = new URL(window.location.href);
    url.searchParams.set("pool", id);
    url.searchParams.set("tab", nextTab);
    history.pushState({}, "", url);
    setPool(id);
    setTab(nextTab);
  }

  function back() {
    const url = new URL(window.location.href);
    url.searchParams.delete("pool");
    url.searchParams.delete("tab");
    history.pushState({}, "", url);
    setPool(null);
  }

  if (!ready) return null;
  if (!pool) return <Markets onOpen={open} />;
  return <Dashboard marketId={pool} initialTab={tab} onBack={back} />;
}
